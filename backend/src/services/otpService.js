"use strict";

const crypto = require("crypto");

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_REQUESTS_PER_WINDOW = 5;

function generateOtp() {
  return crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

function getOtpHmacSecret() {
  const secret = process.env.OTP_HMAC_SECRET || process.env.ADMIN_JWT_SECRET;
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("OTP verification is unavailable.");
  }
  return secret;
}

function hashOtp(destination, purpose, code) {
  const digest = crypto.createHmac("sha256", getOtpHmacSecret())
    .update(`myshopzy-otp-v1\0${destination}\0${purpose}\0${code}`, "utf8")
    .digest();
  return digest;
}

function matchesOtp(storedDigest, destination, purpose, code) {
  const expected = hashOtp(destination, purpose, code);
  const actual = Buffer.from(storedDigest || []);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function isDevelopmentOtpExposureEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.DEV_OTP_EXPOSE === "true";
}

function assertOtpDeliveryAvailable() {
  if (isDevelopmentOtpExposureEnabled()) return;
  const error = new Error("OTP delivery is not configured.");
  error.code = "OTP_DELIVERY_UNAVAILABLE";
  throw error;
}

async function sendOtp({ destination, purpose, code }) {
  assertOtpDeliveryAvailable();

  return {
    channel: "SMS",
    delivered: false,
    development_otp: code
  };
}

module.exports = {
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_REQUEST_WINDOW_MS,
  OTP_MAX_REQUESTS_PER_WINDOW,
  generateOtp,
  hashOtp,
  matchesOtp,
  assertOtpDeliveryAvailable,
  sendOtp,
  isDevelopmentOtpExposureEnabled
};
