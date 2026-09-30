"use strict";

const db = require("../config/db");

const RIDER_EARNING_SETTING_KEY = "rider_earning_config";
const DEFAULT_RIDER_EARNING_CONFIG = Object.freeze({
  version: 1,
  currency: "INR",
  base_earning_inr: 40,
  rain_surge_inr: 15,
  rain_surge_active: false
});

function normalizeAmount(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10000
      || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
    throw new Error(`${name} must be a non-negative INR amount with at most two decimal places.`);
  }
  return Math.round(value * 100) / 100;
}

function normalizeRiderEarningConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Rider earning configuration is invalid.");
  }
  if (value.version !== 1 || value.currency !== "INR" || typeof value.rain_surge_active !== "boolean") {
    throw new Error("Rider earning configuration is invalid.");
  }
  return {
    version: 1,
    currency: "INR",
    base_earning_inr: normalizeAmount(value.base_earning_inr, "Base earning"),
    rain_surge_inr: normalizeAmount(value.rain_surge_inr, "Rain surge"),
    rain_surge_active: value.rain_surge_active
  };
}

async function loadRiderEarningConfig(queryable = db) {
  const result = await queryable.query(
    "SELECT setting_value FROM app_settings WHERE setting_key = $1",
    [RIDER_EARNING_SETTING_KEY]
  );
  if (!result.rows[0]) return { ...DEFAULT_RIDER_EARNING_CONFIG };
  return normalizeRiderEarningConfig(result.rows[0].setting_value);
}

function calculateRiderEarningSnapshot(config) {
  const normalized = normalizeRiderEarningConfig(config);
  const baseCents = Math.round(normalized.base_earning_inr * 100);
  const rainCents = normalized.rain_surge_active ? Math.round(normalized.rain_surge_inr * 100) : 0;
  return {
    version: 1,
    currency: "INR",
    base_earning_inr: baseCents / 100,
    rain_surge_applied: normalized.rain_surge_active,
    rain_surge_inr: rainCents / 100,
    total_earning_inr: (baseCents + rainCents) / 100
  };
}

function validateRiderEarningSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.version !== 1 || value.currency !== "INR"
      || typeof value.rain_surge_applied !== "boolean") {
    throw new Error("Stored rider earning snapshot is invalid.");
  }
  const base = normalizeAmount(value.base_earning_inr, "Snapshot base earning");
  const rain = normalizeAmount(value.rain_surge_inr, "Snapshot rain surge");
  const total = normalizeAmount(value.total_earning_inr, "Snapshot total earning");
  if (Math.round(total * 100) !== Math.round((base + rain) * 100)
      || (!value.rain_surge_applied && rain !== 0)) {
    throw new Error("Stored rider earning snapshot is inconsistent.");
  }
  return {
    version: 1,
    currency: "INR",
    base_earning_inr: base,
    rain_surge_applied: value.rain_surge_applied,
    rain_surge_inr: rain,
    total_earning_inr: total
  };
}

module.exports = {
  RIDER_EARNING_SETTING_KEY,
  DEFAULT_RIDER_EARNING_CONFIG,
  normalizeRiderEarningConfig,
  loadRiderEarningConfig,
  calculateRiderEarningSnapshot,
  validateRiderEarningSnapshot
};
