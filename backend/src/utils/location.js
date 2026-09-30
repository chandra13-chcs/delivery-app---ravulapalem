"use strict";

const EARTH_RADIUS_KM = 6371.0088;

class LocationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LocationValidationError";
    this.status = 400;
  }
}

function parseCoordinate(value, name, minimum, maximum) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value !== "number" && typeof value !== "string") {
    throw new LocationValidationError(`${name} must be a finite coordinate.`);
  }
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < minimum || coordinate > maximum) {
    throw new LocationValidationError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return coordinate;
}

function normalizeOptionalCoordinates(latitude, longitude) {
  return {
    latitude: parseCoordinate(latitude, "Latitude", -90, 90),
    longitude: parseCoordinate(longitude, "Longitude", -180, 180)
  };
}

function normalizeCoordinates(latitude, longitude) {
  const coordinates = normalizeOptionalCoordinates(latitude, longitude);
  if (coordinates.latitude == null || coordinates.longitude == null) {
    throw new LocationValidationError("Both latitude and longitude are required.");
  }
  return coordinates;
}

function haversineDistanceKm(fromLatitude, fromLongitude, toLatitude, toLongitude) {
  const from = normalizeCoordinates(fromLatitude, fromLongitude);
  const to = normalizeCoordinates(toLatitude, toLongitude);
  const toRadians = degrees => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitudeRadians = toRadians(from.latitude);
  const toLatitudeRadians = toRadians(to.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitudeRadians) * Math.cos(toLatitudeRadians)
    * Math.sin(longitudeDelta / 2) ** 2;
  const boundedHaversine = Math.min(1, Math.max(0, haversine));
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(boundedHaversine), Math.sqrt(1 - boundedHaversine));
}

module.exports = {
  EARTH_RADIUS_KM,
  LocationValidationError,
  normalizeOptionalCoordinates,
  normalizeCoordinates,
  haversineDistanceKm
};
