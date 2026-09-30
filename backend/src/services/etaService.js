"use strict";

const db = require("../config/db");
const { normalizeCoordinates, normalizeOptionalCoordinates, haversineDistanceKm } = require("../utils/location");
const { evaluateDeliveryServiceability } = require("./serviceabilityService");

const ETA_CONFIG_SETTING_KEY = "delivery_eta_config";
const ETA_MODES = new Set(["SHOP_TO_CUSTOMER", "RIDER_TO_CUSTOMER"]);
const DEFAULT_ETA_CONFIG = Object.freeze({
  version: 1,
  average_delivery_speed_kmh: 20,
  preparation_buffer_minutes: 10,
  minimum_eta_minutes: 10,
  maximum_eta_buffer_minutes: 10
});

function normalizeInteger(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function normalizeEtaConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) {
    throw new Error("ETA configuration is invalid.");
  }
  const speed = value.average_delivery_speed_kmh;
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 1 || speed > 80) {
    throw new Error("Average delivery speed must be between 1 and 80 km/h.");
  }
  return {
    version: 1,
    average_delivery_speed_kmh: speed,
    preparation_buffer_minutes: normalizeInteger(value.preparation_buffer_minutes, "Preparation buffer", 0, 180),
    minimum_eta_minutes: normalizeInteger(value.minimum_eta_minutes, "Minimum ETA", 0, 180),
    maximum_eta_buffer_minutes: normalizeInteger(value.maximum_eta_buffer_minutes, "Maximum ETA buffer", 0, 120)
  };
}

async function loadEtaConfig(queryable = db) {
  const result = await queryable.query(
    `SELECT setting_value
     FROM app_settings
     WHERE setting_key = $1 AND is_public = false`,
    [ETA_CONFIG_SETTING_KEY]
  );
  return result.rows[0]
    ? normalizeEtaConfig(result.rows[0].setting_value)
    : { ...DEFAULT_ETA_CONFIG };
}

function unavailableEta(reason) {
  return { available: false, reason };
}

function buildEtaEstimate({ origin, destination, mode, config }) {
  if (!ETA_MODES.has(mode)) throw new Error("ETA calculation mode is unsupported.");
  const start = normalizeCoordinates(origin?.latitude, origin?.longitude);
  const end = normalizeCoordinates(destination?.latitude, destination?.longitude);
  const normalizedConfig = normalizeEtaConfig(config);
  const distanceKm = haversineDistanceKm(start.latitude, start.longitude, end.latitude, end.longitude);
  const travelMinutes = Math.ceil((distanceKm / normalizedConfig.average_delivery_speed_kmh) * 60);
  const preparationMinutes = mode === "SHOP_TO_CUSTOMER" ? normalizedConfig.preparation_buffer_minutes : 0;
  const etaMinMinutes = Math.max(normalizedConfig.minimum_eta_minutes, travelMinutes + preparationMinutes);
  return {
    available: true,
    distance_km: Number(distanceKm.toFixed(2)),
    eta_min_minutes: etaMinMinutes,
    eta_max_minutes: etaMinMinutes + normalizedConfig.maximum_eta_buffer_minutes,
    method: "HAVERSINE_SPEED_ESTIMATE"
  };
}

async function calculateEta({ origin, destination, mode }, queryable = db) {
  const config = await loadEtaConfig(queryable);
  return buildEtaEstimate({ origin, destination, mode, config });
}

async function calculateCustomerOrderEta(order, queryable = db) {
  if (!order || ["DELIVERED", "CANCELLED", "REJECTED"].includes(order.status)) {
    return unavailableEta("ORDER_NOT_ACTIVE");
  }
  if (order.order_type !== "GOODS") return unavailableEta("PICKUP_COORDINATES_UNAVAILABLE");

  let destination;
  try {
    destination = normalizeOptionalCoordinates(order.delivery_latitude, order.delivery_longitude);
  } catch {
    return unavailableEta("DELIVERY_COORDINATES_INVALID");
  }
  if (destination.latitude === null || destination.longitude === null) {
    return unavailableEta("DELIVERY_COORDINATES_UNAVAILABLE");
  }

  const serviceability = await evaluateDeliveryServiceability({
    latitude: destination.latitude,
    longitude: destination.longitude,
    postal_code: order.delivery_postal_code
  }, queryable);
  if (!serviceability.serviceable) return unavailableEta("OUTSIDE_SERVICE_AREA");

  const fulfillmentResult = await queryable.query(
    `SELECT s.latitude, s.longitude
     FROM order_fulfillments f
     LEFT JOIN shops s ON s.id = f.shop_id AND s.deleted_at IS NULL
     WHERE f.order_id = $1
     ORDER BY f.created_at ASC, f.id ASC`,
    [order.id]
  );
  if (fulfillmentResult.rows.length === 0) return unavailableEta("PICKUP_COORDINATES_UNAVAILABLE");
  if (fulfillmentResult.rows.length !== 1) return unavailableEta("MULTIPLE_PICKUP_POINTS_UNSUPPORTED");

  let origin;
  try {
    origin = normalizeOptionalCoordinates(fulfillmentResult.rows[0].latitude, fulfillmentResult.rows[0].longitude);
  } catch {
    return unavailableEta("PICKUP_COORDINATES_INVALID");
  }
  if (origin.latitude === null || origin.longitude === null) {
    return unavailableEta("PICKUP_COORDINATES_UNAVAILABLE");
  }

  return calculateEta({ origin, destination, mode: "SHOP_TO_CUSTOMER" }, queryable);
}

module.exports = {
  ETA_CONFIG_SETTING_KEY,
  DEFAULT_ETA_CONFIG,
  ETA_MODES,
  normalizeEtaConfig,
  loadEtaConfig,
  unavailableEta,
  buildEtaEstimate,
  calculateEta,
  calculateCustomerOrderEta
};
