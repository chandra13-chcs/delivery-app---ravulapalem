"use strict";

const crypto = require("crypto");

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_REQUESTS_PER_WINDOW = 5;
let testModeActiveLogged = false;

function generateOtp() {
  if (isOtpTestModeEnabled()) return getTestOtpCode();
  return crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

function getOtpHmacSecret() {
  const secret = process.env.OTP_HMAC_SECRET || process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET;
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

function isOtpTestModeEnabled() {
  return process.env.OTP_TEST_MODE === "true";
}

function getTestOtpCode() {
  const code = process.env.OTP_TEST_CODE || "123456";
  if (!/^\d{6}$/.test(code)) {
    const error = new Error("OTP test code configuration is invalid.");
    error.code = "OTP_TEST_CONFIGURATION_INVALID";
    throw error;
  }
  return code;
}

function assertOtpDeliveryAvailable() {
  if (isOtpTestModeEnabled()) {
    getTestOtpCode();
    return;
  }
  const error = new Error("OTP delivery is not configured.");
  error.code = "OTP_DELIVERY_UNAVAILABLE";
  throw error;
}

async function sendOtp() {
  assertOtpDeliveryAvailable();

  if (isOtpTestModeEnabled()) {
    if (!testModeActiveLogged) {
      console.log("OTP test mode is active.");
      testModeActiveLogged = true;
    }
    return {
      channel: "SMS",
      delivered: true
    };
  }

  return {
    channel: "SMS",
    delivered: false
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
  isOtpTestModeEnabled
};
