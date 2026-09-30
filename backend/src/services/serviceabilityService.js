"use strict";

const db = require("../config/db");
const { normalizeOptionalCoordinates, haversineDistanceKm } = require("../utils/location");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GEOJSON_GEOMETRY_LIMIT = 32;
const GEOJSON_RING_LIMIT = 64;
const GEOJSON_RING_POSITION_LIMIT = 512;
const GEOJSON_TOTAL_POSITION_LIMIT = 2048;
const GEOJSON_DEPTH_LIMIT = 8;
const EDGE_EPSILON = 1e-10;

function locationError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePostalCode(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw locationError(400, "Postal code must be a string or number.");
  }
  const postalCode = String(value).trim().toUpperCase();
  if (!postalCode || postalCode.length > 16) throw locationError(400, "Postal code is invalid.");
  return postalCode;
}

function validPosition(position) {
  return Array.isArray(position) && position.length >= 2
    && typeof position[0] === "number" && Number.isFinite(position[0])
    && position[0] >= -180 && position[0] <= 180
    && typeof position[1] === "number" && Number.isFinite(position[1])
    && position[1] >= -90 && position[1] <= 90;
}

function samePosition(left, right) {
  return Math.abs(left[0] - right[0]) <= EDGE_EPSILON
    && Math.abs(left[1] - right[1]) <= EDGE_EPSILON;
}

function pointOnSegment(point, start, end) {
  const cross = (point[1] - start[1]) * (end[0] - start[0])
    - (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > EDGE_EPSILON) return false;
  return point[0] >= Math.min(start[0], end[0]) - EDGE_EPSILON
    && point[0] <= Math.max(start[0], end[0]) + EDGE_EPSILON
    && point[1] >= Math.min(start[1], end[1]) - EDGE_EPSILON
    && point[1] <= Math.max(start[1], end[1]) + EDGE_EPSILON;
}

function validLinearRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > GEOJSON_RING_POSITION_LIMIT
      || !ring.every(validPosition)
      || ring[0][0] !== ring[ring.length - 1][0]
      || ring[0][1] !== ring[ring.length - 1][1]) return false;

  const vertices = ring.slice(0, -1);
  if (vertices.length < 3 || vertices.some((vertex, index) => samePosition(vertex, vertices[(index + 1) % vertices.length]))) {
    return false;
  }

  let twiceArea = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  if (Math.abs(twiceArea) <= EDGE_EPSILON) return false;

  for (let index = 0; index < vertices.length; index += 1) {
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    if (Math.abs(orientation(previous, current, next)) <= EDGE_EPSILON) {
      const previousX = previous[0] - current[0];
      const previousY = previous[1] - current[1];
      const nextX = next[0] - current[0];
      const nextY = next[1] - current[1];
      if (previousX * nextX + previousY * nextY > EDGE_EPSILON) return false;
    }
  }

  for (let first = 0; first < vertices.length; first += 1) {
    const firstNext = (first + 1) % vertices.length;
    for (let second = first + 1; second < vertices.length; second += 1) {
      const secondNext = (second + 1) % vertices.length;
      if (second === firstNext || (first === 0 && secondNext === 0)) continue;
      if (segmentsIntersect(vertices[first], vertices[firstNext], vertices[second], vertices[secondNext])) return false;
    }
  }
  return true;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const start = ring[previous];
    const end = ring[index];
    if (pointOnSegment(point, start, end)) return true;
    const crosses = (end[1] > point[1]) !== (start[1] > point[1])
      && point[0] < ((start[0] - end[0]) * (point[1] - end[1])) / (start[1] - end[1]) + end[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function orientation(first, second, third) {
  return (second[0] - first[0]) * (third[1] - first[1])
    - (second[1] - first[1]) * (third[0] - first[0]);
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart);
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);

  if (((firstOrientation > EDGE_EPSILON && secondOrientation < -EDGE_EPSILON)
      || (firstOrientation < -EDGE_EPSILON && secondOrientation > EDGE_EPSILON))
      && ((thirdOrientation > EDGE_EPSILON && fourthOrientation < -EDGE_EPSILON)
      || (thirdOrientation < -EDGE_EPSILON && fourthOrientation > EDGE_EPSILON))) return true;

  return (Math.abs(firstOrientation) <= EDGE_EPSILON && pointOnSegment(secondStart, firstStart, firstEnd))
    || (Math.abs(secondOrientation) <= EDGE_EPSILON && pointOnSegment(secondEnd, firstStart, firstEnd))
    || (Math.abs(thirdOrientation) <= EDGE_EPSILON && pointOnSegment(firstStart, secondStart, secondEnd))
    || (Math.abs(fourthOrientation) <= EDGE_EPSILON && pointOnSegment(firstEnd, secondStart, secondEnd));
}

function ringsIntersect(firstRing, secondRing) {
  const firstVertices = firstRing.slice(0, -1);
  const secondVertices = secondRing.slice(0, -1);
  for (let first = 0; first < firstVertices.length; first += 1) {
    for (let second = 0; second < secondVertices.length; second += 1) {
      if (segmentsIntersect(
        firstVertices[first], firstVertices[(first + 1) % firstVertices.length],
        secondVertices[second], secondVertices[(second + 1) % secondVertices.length]
      )) return true;
    }
  }
  return false;
}

function pointInPolygonCoordinates(point, rings) {
  if (!pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some(ring => pointInRing(point, ring));
}

function validatePolygon(rings, budget) {
  if (!Array.isArray(rings) || rings.length === 0 || budget.rings + rings.length > GEOJSON_RING_LIMIT) return null;
  let positionCount = 0;
  for (const ring of rings) {
    if (!validLinearRing(ring)) return null;
    positionCount += ring.length;
  }
  if (budget.positions + positionCount > GEOJSON_TOTAL_POSITION_LIMIT) return null;

  const outerRing = rings[0];
  for (let index = 1; index < rings.length; index += 1) {
    const hole = rings[index];
    if (ringsIntersect(outerRing, hole) || !pointInRing(hole[0], outerRing)) return null;
    for (let previous = 1; previous < index; previous += 1) {
      const priorHole = rings[previous];
      if (ringsIntersect(priorHole, hole)
          || pointInRing(hole[0], priorHole)
          || pointInRing(priorHole[0], hole)) return null;
    }
  }

  budget.rings += rings.length;
  budget.positions += positionCount;
  budget.geometries += 1;
  return rings;
}

function polygonComponentsOverlap(firstPolygon, secondPolygon) {
  for (const firstRing of firstPolygon) {
    for (const secondRing of secondPolygon) {
      if (ringsIntersect(firstRing, secondRing)) return true;
    }
  }
  return firstPolygon[0].slice(0, -1).some(point => pointInPolygonCoordinates(point, secondPolygon))
    || secondPolygon[0].slice(0, -1).some(point => pointInPolygonCoordinates(point, firstPolygon));
}

function parseGeoJSONPolygons(value, budget, output, depth = 0) {
  if (!value || typeof value !== "object" || depth > GEOJSON_DEPTH_LIMIT) return false;
  if (value.type === "Feature") return parseGeoJSONPolygons(value.geometry, budget, output, depth + 1);

  if (value.type === "FeatureCollection" || value.type === "GeometryCollection") {
    const children = value.type === "FeatureCollection" ? value.features : value.geometries;
    if (!Array.isArray(children) || children.length === 0 || children.length > GEOJSON_GEOMETRY_LIMIT) return false;
    return children.every(child => parseGeoJSONPolygons(child, budget, output, depth + 1));
  }

  const components = value.type === "Polygon"
    ? [value.coordinates]
    : value.type === "MultiPolygon" ? value.coordinates : null;
  if (!Array.isArray(components) || components.length === 0
      || components.length > GEOJSON_GEOMETRY_LIMIT
      || budget.geometries + components.length > GEOJSON_GEOMETRY_LIMIT) return false;

  for (const component of components) {
    const polygon = validatePolygon(component, budget);
    if (!polygon || output.some(existing => polygonComponentsOverlap(existing, polygon))) return false;
    output.push(polygon);
  }
  return true;
}

function pointInGeoJSON(latitude, longitude, boundaryGeoJson) {
  let boundary = boundaryGeoJson;
  if (typeof boundary === "string") {
    try {
      boundary = JSON.parse(boundary);
    } catch {
      return false;
    }
  }
  const point = [longitude, latitude];
  if (!validPosition(point)) return false;
  const polygons = [];
  const budget = { geometries: 0, rings: 0, positions: 0 };
  if (!parseGeoJSONPolygons(boundary, budget, polygons)) return false;
  return polygons.some(polygon => pointInPolygonCoordinates(point, polygon));
}

function matchedArea(area) {
  return {
    id: area.id,
    name: area.name,
    coverage_type: area.coverage_type,
    ...(area.coverage_type === "RADIUS" ? { radius_km: Number(area.radius_km) } : {})
  };
}

async function evaluateDeliveryServiceability(input = {}, queryable = db) {
  const coordinates = normalizeOptionalCoordinates(input.latitude, input.longitude);
  const postalCode = normalizePostalCode(input.postal_code ?? input.postalCode);
  const shopId = input.shop_id ?? input.shopId ?? null;
  if (shopId != null && !UUID_PATTERN.test(String(shopId))) {
    throw locationError(400, "Shop id is invalid.");
  }

  let shopDistanceKm = null;
  if (shopId) {
    const shopResult = await queryable.query(
      `SELECT id, latitude, longitude
       FROM shops
       WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
      [shopId]
    );
    const shop = shopResult.rows[0];
    if (!shop) throw locationError(404, "Active shop not found.");
    const shopCoordinates = normalizeOptionalCoordinates(shop.latitude, shop.longitude);
    if (coordinates.latitude !== null && coordinates.longitude !== null
        && shopCoordinates.latitude !== null && shopCoordinates.longitude !== null) {
      shopDistanceKm = haversineDistanceKm(
        coordinates.latitude, coordinates.longitude,
        shopCoordinates.latitude, shopCoordinates.longitude
      );
    }
  }

  const areasResult = await queryable.query(
    `SELECT id, name, coverage_type, postal_codes, center_latitude,
            center_longitude, radius_km, boundary_geojson
     FROM serviceable_areas
     WHERE is_active = true
     ORDER BY created_at ASC, id ASC`
  );
  const areas = areasResult.rows;
  let closestRadiusDistanceKm = null;
  let matched = null;
  let matchedDistanceKm = null;
  let distanceSource = null;

  for (const area of areas) {
    if (area.coverage_type === "POSTAL_CODES") {
      const postalCodes = Array.isArray(area.postal_codes)
        ? area.postal_codes.map(code => String(code).trim().toUpperCase())
        : [];
      if (postalCode && postalCodes.includes(postalCode)) {
        matched = area;
        break;
      }
    } else if (area.coverage_type === "RADIUS"
        && coordinates.latitude !== null && coordinates.longitude !== null) {
      const distance = haversineDistanceKm(
        coordinates.latitude, coordinates.longitude,
        area.center_latitude, area.center_longitude
      );
      if (closestRadiusDistanceKm === null || distance < closestRadiusDistanceKm) closestRadiusDistanceKm = distance;
      if (distance <= Number(area.radius_km)) {
        matched = area;
        matchedDistanceKm = distance;
        distanceSource = "RADIUS_CENTER";
        break;
      }
    } else if (area.coverage_type === "GEOJSON"
        && coordinates.latitude !== null && coordinates.longitude !== null
        && pointInGeoJSON(coordinates.latitude, coordinates.longitude, area.boundary_geojson)) {
      matched = area;
      break;
    }
  }

  if (matched && shopDistanceKm !== null) distanceSource = "SHOP";
  const distanceKm = shopDistanceKm ?? (matched ? matchedDistanceKm : closestRadiusDistanceKm);
  if (!distanceSource && matchedDistanceKm !== null) distanceSource = "RADIUS_CENTER";
  if (!distanceSource && !matched && closestRadiusDistanceKm !== null) distanceSource = "NEAREST_RADIUS_CENTER";
  return {
    serviceable: Boolean(matched),
    matched_area: matched ? matchedArea(matched) : null,
    distance_km: distanceKm == null ? null : Number(distanceKm.toFixed(3)),
    shop_distance_km: shopDistanceKm == null ? null : Number(shopDistanceKm.toFixed(3)),
    distance_source: distanceSource,
    shop_specific_supported: false,
    reason: matched
      ? `SERVICEABLE_${matched.coverage_type}`
      : areas.length === 0
        ? "NO_ACTIVE_SERVICEABLE_AREAS"
        : !postalCode && (coordinates.latitude === null || coordinates.longitude === null)
          ? "LOCATION_REQUIRED"
          : "OUTSIDE_SERVICE_AREA"
  };
}

module.exports = {
  evaluateDeliveryServiceability,
  pointInGeoJSON
};
