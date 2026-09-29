"use strict";

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const {
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
} = require("../services/otpService");

const JWT_ISSUER = "myshopzy-api";
const JWT_AUDIENCE = "myshopzy-admin";
const ACCESS_TOKEN_LIFETIME = "15m";
const ACCESS_TOKEN_LIFETIME_MS = 15 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const OTP_PATTERN = /^\d{6}$/;

function getSigningSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32
    ? secret
    : null;
}

function sendAuthUnavailable(res) {
  return res.status(503).json({ success: false, message: "Authentication is unavailable." });
}

function normalizePhone(value) {
  if (typeof value !== "string") return "";
  const phone = value.trim();
  if (PHONE_PATTERN.test(phone)) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  return "";
}

function validateRegistration(body) {
  const displayName = typeof body?.display_name === "string" ? body.display_name.trim() : "";
  const phone = normalizePhone(body?.phone_e164);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!displayName || displayName.length > 100 || !phone
      || !EMAIL_PATTERN.test(email) || email.length > 254
      || Buffer.byteLength(password, "utf8") < 6 || Buffer.byteLength(password, "utf8") > 1024) {
    return null;
  }
  return { displayName, phone, email, password };
}

function validatePhoneBody(body) {
  const phone = normalizePhone(body?.phone_e164);
  return phone ? phone : null;
}

async function enforceOtpRequestLimit(queryable, destination, requestIp) {
  await queryable.query(
    "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
    ["myshopzy-otp-request", `${destination}:${requestIp || "unknown"}`]
  );
  const result = await queryable.query(
    `SELECT count(*)::int AS request_count
     FROM otp_verifications
     WHERE created_at > now() - ($3::text || ' milliseconds')::interval
       AND (destination = $1 OR ($2::inet IS NOT NULL AND request_ip = $2::inet))`,
    [destination, requestIp || null, OTP_REQUEST_WINDOW_MS]
  );
  if (result.rows[0]?.request_count >= OTP_MAX_REQUESTS_PER_WINDOW) {
    const error = new Error("Too many OTP requests. Try again later.");
    error.status = 429;
    throw error;
  }
}

async function createOtpChallenge(queryable, { userId, destination, purpose, requestIp }) {
  const code = generateOtp();
  await queryable.query(
    `UPDATE otp_verifications
     SET consumed_at = now()
     WHERE destination = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [destination, purpose]
  );
  await queryable.query(
    `INSERT INTO otp_verifications
       (user_id, destination, channel, purpose, otp_hmac, expires_at, max_attempts, request_ip)
     VALUES ($1, $2, 'SMS', $3, $4, now() + ($5::text || ' milliseconds')::interval, $6, $7)`,
    [userId, destination, purpose, hashOtp(destination, purpose, code), OTP_TTL_MS, OTP_MAX_ATTEMPTS, requestIp || null]
  );
  return code;
}

function developmentOtpResponse(delivery) {
  return isDevelopmentOtpExposureEnabled()
    ? { development_otp: delivery.development_otp }
    : {};
}

async function registerCustomer(req, res) {
  const registration = validateRegistration(req.body);
  if (!registration) {
    return res.status(400).json({ success: false, message: "Provide a valid name, email, mobile number, and password of at least 6 characters." });
  }
  const secret = getSigningSecret();
  if (!secret) return sendAuthUnavailable(res);
  try {
    assertOtpDeliveryAvailable();
  } catch {
    return res.status(503).json({ success: false, message: "OTP delivery is not configured." });
  }

  let client;
  try {
    const passwordHash = await bcrypt.hash(registration.password, 12);
    client = await db.connect();
    await client.query("BEGIN");
    await enforceOtpRequestLimit(client, registration.phone, req.ip);
    const existingResult = await client.query(
      `SELECT id, phone_e164, email, password_hash, status
       FROM users
       WHERE phone_e164 = $1 OR lower(email) = lower($2)
       ORDER BY created_at ASC
       LIMIT 2
       FOR UPDATE`,
      [registration.phone, registration.email]
    );
    let userId;
    if (existingResult.rows.length) {
      const existing = existingResult.rows[0];
      const sameContact = existingResult.rows.length === 1
        && existing.phone_e164 === registration.phone
        && (existing.email == null || existing.email.toLowerCase() === registration.email);
      if (!sameContact || existing.status !== "PENDING") {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "An account with that mobile number or email already exists." });
      }
      if (existing.password_hash) {
        const passwordMatches = await bcrypt.compare(registration.password, existing.password_hash).catch(() => false);
        if (!passwordMatches) {
          await client.query("ROLLBACK");
          return res.status(409).json({ success: false, message: "An account with that mobile number or email already exists." });
        }
      }
      const updated = await client.query(
        `UPDATE users
         SET password_hash = COALESCE(password_hash, $2),
           email = COALESCE(email, $3),
           updated_at = now()
         WHERE id = $1 AND status = 'PENDING' AND deleted_at IS NULL
         RETURNING id`,
        [existing.id, passwordHash, registration.email]
      );
      if (!updated.rows[0]) throw new Error("Pending customer registration could not be resumed.");
      userId = updated.rows[0].id;
    } else {
      const userResult = await client.query(
        `INSERT INTO users (phone_e164, email, password_hash, display_name, status)
         VALUES ($1, $2, $3, $4, 'PENDING')
         RETURNING id`,
        [registration.phone, registration.email, passwordHash, registration.displayName]
      );
      userId = userResult.rows[0].id;
    }
    const code = await createOtpChallenge(client, {
      userId,
      destination: registration.phone,
      purpose: "REGISTER",
      requestIp: req.ip
    });
    await client.query("COMMIT");
    const delivery = await sendOtp({ destination: registration.phone, purpose: "REGISTER", code });
    res.set("Cache-Control", "no-store");
    return res.status(202).json({
      success: true,
      message: "Verification code requested.",
      ...(delivery.channel ? { channel: delivery.channel } : {}),
      ...developmentOtpResponse(delivery)
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") {
      return res.status(409).json({ success: false, message: "An account with that mobile number or email already exists." });
    }
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Customer registration failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to register customer." });
  } finally {
    client?.release();
  }
}

async function requestLoginOtp(req, res) {
  const phone = validatePhoneBody(req.body);
  if (!phone) return res.status(400).json({ success: false, message: "A valid mobile number is required." });
  if (!getSigningSecret()) return sendAuthUnavailable(res);
  try {
    assertOtpDeliveryAvailable();
  } catch {
    return res.status(503).json({ success: false, message: "OTP delivery is not configured." });
  }

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    await enforceOtpRequestLimit(client, phone, req.ip);
    const result = await client.query(
      `SELECT id
       FROM users
       WHERE phone_e164 = $1
         AND status = 'ACTIVE'
         AND deleted_at IS NULL
       LIMIT 1`,
      [phone]
    );
    const user = result.rows[0];
    if (!user) {
      await client.query("COMMIT");
      res.set("Cache-Control", "no-store");
      return res.status(202).json({ success: true, message: "If the account is eligible, a verification code will be sent." });
    }
    const code = await createOtpChallenge(client, {
      userId: user.id,
      destination: phone,
      purpose: "LOGIN",
      requestIp: req.ip
    });
    await client.query("COMMIT");
    const delivery = await sendOtp({ destination: phone, purpose: "LOGIN", code });
    res.set("Cache-Control", "no-store");
    return res.status(202).json({
      success: true,
      message: "If the account is eligible, a verification code will be sent.",
      ...(delivery.channel ? { channel: delivery.channel } : {}),
      ...developmentOtpResponse(delivery)
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Customer OTP request failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to request verification code." });
  } finally {
    client?.release();
  }
}

function createUserAccessToken(userId, sessionId, secret) {
  return jwt.sign(
    { token_use: "user_access", sid: sessionId },
    secret,
    {
      algorithm: "HS256",
      audience: JWT_AUDIENCE,
      expiresIn: ACCESS_TOKEN_LIFETIME,
      issuer: JWT_ISSUER,
      subject: userId
    }
  );
}

function publicCustomer(user) {
  return {
    id: user.id,
    display_name: user.display_name,
    phone_e164: user.phone_e164,
    email: user.email,
    phone_verified_at: user.phone_verified_at,
    email_verified_at: user.email_verified_at
  };
}

async function verifyCustomerOtp(req, res) {
  const phone = validatePhoneBody(req.body);
  const purpose = String(req.body?.purpose || "").toUpperCase();
  const code = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!phone || !["REGISTER", "LOGIN"].includes(purpose) || !OTP_PATTERN.test(code)) {
    return res.status(400).json({ success: false, message: "Mobile number, verification purpose, or code is invalid." });
  }
  const secret = getSigningSecret();
  if (!secret) return sendAuthUnavailable(res);

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const challengeResult = await client.query(
      `SELECT id, user_id, otp_hmac, attempt_count, max_attempts
       FROM otp_verifications
       WHERE destination = $1
         AND purpose = $2
         AND channel = 'SMS'
         AND consumed_at IS NULL
         AND expires_at > now()
         AND attempt_count < max_attempts
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [phone, purpose]
    );
    const challenge = challengeResult.rows[0];
    if (!challenge || !matchesOtp(challenge.otp_hmac, phone, purpose, code)) {
      if (challenge) {
        await client.query(
          `UPDATE otp_verifications
           SET attempt_count = attempt_count + 1,
               consumed_at = CASE WHEN attempt_count + 1 >= max_attempts THEN now() ELSE consumed_at END
           WHERE id = $1`,
          [challenge.id]
        );
      }
      await client.query("COMMIT");
      return res.status(401).json({ success: false, message: "Invalid or expired verification code." });
    }

    const userResult = await client.query(
      `SELECT id, display_name, phone_e164, email, status, phone_verified_at, email_verified_at
       FROM users
       WHERE id = $1 AND phone_e164 = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [challenge.user_id, phone]
    );
    const user = userResult.rows[0];
    if (!user || (purpose === "REGISTER" && user.status !== "PENDING")
        || (purpose === "LOGIN" && user.status !== "ACTIVE")) {
      await client.query("UPDATE otp_verifications SET consumed_at = now() WHERE id = $1", [challenge.id]);
      await client.query("COMMIT");
      return res.status(401).json({ success: false, message: "Invalid or expired verification code." });
    }

    const activatedResult = await client.query(
      `UPDATE users
       SET status = 'ACTIVE', phone_verified_at = COALESCE(phone_verified_at, now()), updated_at = now()
       WHERE id = $1 AND status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL
       RETURNING id, display_name, phone_e164, email, phone_verified_at, email_verified_at`,
      [user.id]
    );
    const activeUser = activatedResult.rows[0];
    if (!activeUser) {
      await client.query("UPDATE otp_verifications SET consumed_at = now() WHERE id = $1", [challenge.id]);
      await client.query("COMMIT");
      return res.status(401).json({ success: false, message: "Invalid or expired verification code." });
    }
    await client.query("UPDATE otp_verifications SET consumed_at = now() WHERE id = $1", [challenge.id]);

    const sessionSecretHash = crypto.createHash("sha256").update(crypto.randomBytes(64)).digest();
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_LIFETIME_MS);
    const userAgent = typeof req.get("user-agent") === "string" ? req.get("user-agent").slice(0, 512) : null;
    const sessionResult = await client.query(
      `INSERT INTO user_sessions (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [activeUser.id, sessionSecretHash, userAgent, req.ip || null, expiresAt]
    );
    const sessionId = sessionResult.rows[0].id;
    const accessToken = createUserAccessToken(activeUser.id, sessionId, secret);
    await client.query("COMMIT");

    res.set("Cache-Control", "no-store");
    return res.json({
      success: true,
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_LIFETIME_MS / 1000,
      user: publicCustomer(activeUser)
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Customer OTP verification failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to verify code." });
  } finally {
    client?.release();
  }
}

async function getCurrentCustomer(req, res) {
  try {
    const result = await db.query(
      `SELECT id, display_name, phone_e164, email, phone_verified_at, email_verified_at
       FROM users
       WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(401).json({ success: false, message: "Authentication required." });
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, user: publicCustomer(result.rows[0]) });
  } catch (error) {
    console.error("Customer identity lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve customer identity." });
  }
}

async function logoutCustomer(req, res) {
  try {
    await db.query(
      `UPDATE user_sessions
       SET revoked_at = now(), last_used_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [req.user.session_id, req.user.id]
    );
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, message: "Signed out." });
  } catch (error) {
    console.error("Customer logout failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to sign out." });
  }
}

module.exports = {
  registerCustomer,
  requestLoginOtp,
  verifyCustomerOtp,
  getCurrentCustomer,
  logoutCustomer
};
