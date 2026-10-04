"use strict";

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { writeAuditLog } = require("../services/auditService");
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
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
let dummyPasswordHashPromise = null;

function getSigningSecret() {
  const secret = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET;
  return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32 ? secret : null;
}

function normalizePhone(value) {
  if (typeof value !== "string") return "";
  const phone = value.trim();
  if (/^\+[1-9][0-9]{7,14}$/.test(phone)) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return "";
}

function hashInviteToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest();
}

function createPartnerAccessToken(userId, sessionId, secret, invite = null) {
  return jwt.sign(
    {
      token_use: "partner_access",
      sid: sessionId,
      ...(invite ? { partner_invite_id: invite.id, partner_invite_purpose: invite.purpose } : {})
    },
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

async function createPartnerSession(queryable, req, userId, secret, invite = null) {
  const sessionSecretHash = crypto.createHash("sha256").update(crypto.randomBytes(64)).digest();
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_LIFETIME_MS);
  const userAgent = typeof req.get("user-agent") === "string" ? req.get("user-agent").slice(0, 512) : null;
  const result = await queryable.query(
    `INSERT INTO user_sessions (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, sessionSecretHash, userAgent, req.ip || null, expiresAt]
  );
  return {
    access_token: createPartnerAccessToken(userId, result.rows[0].id, secret, invite),
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_LIFETIME_MS / 1000
  };
}

async function enforcePartnerOtpRequestLimit(queryable, destination, requestIp) {
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

async function requestPartnerInviteOtp(req, res) {
  const inviteToken = typeof req.body?.invite_token === "string" ? req.body.invite_token : "";
  const phone = normalizePhone(req.body?.phone_e164);
  if (!INVITE_TOKEN_PATTERN.test(inviteToken) || !phone) {
    return res.status(400).json({ success: false, message: "A valid invite and mobile number are required." });
  }
  const secret = getSigningSecret();
  if (!secret) return res.status(503).json({ success: false, message: "Authentication is unavailable." });
  try {
    assertOtpDeliveryAvailable();
  } catch {
    return res.status(503).json({ success: false, message: "OTP delivery is not configured." });
  }

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const inviteResult = await client.query(
      `SELECT i.id, i.user_id, i.purpose, i.expires_at,
              u.phone_e164
       FROM partner_invites i
       JOIN users u ON u.id = i.user_id
       JOIN partners p ON p.id = i.partner_id
       JOIN partner_members pm ON pm.partner_id = i.partner_id AND pm.user_id = i.user_id
       WHERE i.token_hash = $1
         AND i.consumed_at IS NULL AND i.expires_at > now()
         AND u.phone_e164 = $2 AND u.status IN ('ACTIVE', 'PENDING') AND u.deleted_at IS NULL
         AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
         AND pm.status = 'ACTIVE'`,
      [hashInviteToken(inviteToken), phone]
    );
    const invite = inviteResult.rows[0];
    if (!invite) {
      await client.query("ROLLBACK");
      return res.status(401).json({ success: false, message: "This invitation is invalid, expired, or does not match the mobile number." });
    }
    const purpose = invite.purpose === "SETUP" ? "PARTNER_SETUP" : "PARTNER_RESET";
    await enforcePartnerOtpRequestLimit(client, phone, req.ip);
    const code = generateOtp();
    await client.query(
      `UPDATE otp_verifications
       SET consumed_at = now()
       WHERE destination = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [phone, purpose]
    );
    await client.query(
      `INSERT INTO otp_verifications
         (user_id, destination, channel, purpose, otp_hmac, expires_at, max_attempts, request_ip)
       VALUES ($1, $2, 'SMS', $3, $4,
         now() + ($5::text || ' milliseconds')::interval, $6, $7)`,
      [invite.user_id, phone, purpose, hashOtp(phone, purpose, code), OTP_TTL_MS, OTP_MAX_ATTEMPTS, req.ip || null]
    );
    await client.query("COMMIT");
    const delivery = await sendOtp({ destination: phone, purpose, code });
    res.set("Cache-Control", "no-store");
    return res.status(202).json({
      success: true,
      message: "If this invitation is valid, a verification code will be sent.",
      ...(isDevelopmentOtpExposureEnabled() ? { development_otp: delivery.development_otp } : {})
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Partner invite OTP request failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to request partner verification code." });
  } finally {
    client?.release();
  }
}

async function verifyPartnerInviteOtp(req, res) {
  const inviteToken = typeof req.body?.invite_token === "string" ? req.body.invite_token : "";
  const phone = normalizePhone(req.body?.phone_e164);
  const code = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!INVITE_TOKEN_PATTERN.test(inviteToken) || !phone || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, message: "Invitation, mobile number, or verification code is invalid." });
  }
  const secret = getSigningSecret();
  if (!secret) return res.status(503).json({ success: false, message: "Authentication is unavailable." });

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const inviteResult = await client.query(
      `SELECT i.id, i.user_id, i.partner_id, i.purpose, i.expires_at,
              u.phone_e164
       FROM partner_invites i
       JOIN users u ON u.id = i.user_id
       JOIN partners p ON p.id = i.partner_id
       JOIN partner_members pm ON pm.partner_id = i.partner_id AND pm.user_id = i.user_id
       WHERE i.token_hash = $1
         AND i.consumed_at IS NULL AND i.expires_at > now()
         AND u.phone_e164 = $2 AND u.status IN ('ACTIVE', 'PENDING') AND u.deleted_at IS NULL
         AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
         AND pm.status = 'ACTIVE'
       FOR UPDATE OF i, u, p, pm`,
      [hashInviteToken(inviteToken), phone]
    );
    const invite = inviteResult.rows[0];
    if (!invite) {
      await client.query("ROLLBACK");
      return res.status(401).json({ success: false, message: "This invitation is invalid, expired, or already used." });
    }
    const otpPurpose = invite.purpose === "SETUP" ? "PARTNER_SETUP" : "PARTNER_RESET";
    const challengeResult = await client.query(
      `SELECT id, otp_hmac FROM otp_verifications
       WHERE user_id = $1 AND destination = $2 AND purpose = $3 AND channel = 'SMS'
         AND consumed_at IS NULL AND expires_at > now() AND attempt_count < max_attempts
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [invite.user_id, phone, otpPurpose]
    );
    const challenge = challengeResult.rows[0];
    if (!challenge || !matchesOtp(challenge.otp_hmac, phone, otpPurpose, code)) {
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
    await client.query("UPDATE otp_verifications SET consumed_at = now() WHERE id = $1", [challenge.id]);
    await client.query("UPDATE partner_invites SET consumed_at = now() WHERE id = $1", [invite.id]);
    await client.query(
      `UPDATE users
       SET status = 'ACTIVE', phone_verified_at = COALESCE(phone_verified_at, now()), updated_at = now()
       WHERE id = $1 AND status = 'PENDING'`,
      [invite.user_id]
    );
    const session = await createPartnerSession(client, req, invite.user_id, secret, invite);
    await client.query("COMMIT");
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, ...session });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Partner invite OTP verification failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to verify partner invitation." });
  } finally {
    client?.release();
  }
}

async function getDummyPasswordHash() {
  if (!dummyPasswordHashPromise) {
    dummyPasswordHashPromise = bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
  }
  return dummyPasswordHashPromise;
}

async function loginPartnerWithPassword(req, res) {
  const phone = normalizePhone(req.body?.phone);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!phone || !password || Buffer.byteLength(password, "utf8") > 1024) {
    return res.status(400).json({ success: false, message: "A valid mobile number and password are required." });
  }
  const secret = getSigningSecret();
  if (!secret) return res.status(503).json({ success: false, message: "Authentication is unavailable." });

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      ["myshopzy-partner-password-login", `${phone}:${req.ip || "unknown"}`]
    );
    await client.query(
      "DELETE FROM partner_password_login_attempts WHERE created_at < now() - interval '24 hours'"
    );
    const attempts = await client.query(
      `SELECT count(*)::int AS attempt_count
       FROM partner_password_login_attempts
       WHERE created_at > now() - interval '15 minutes'
         AND (phone_e164 = $1 OR ($2::inet IS NOT NULL AND request_ip = $2::inet))`,
      [phone, req.ip || null]
    );
    if (attempts.rows[0].attempt_count >= 10) {
      await client.query("ROLLBACK");
      return res.status(429).json({ success: false, message: "Too many sign-in attempts. Try again in 15 minutes." });
    }
    await client.query(
      "INSERT INTO partner_password_login_attempts (phone_e164, request_ip) VALUES ($1, $2)",
      [phone, req.ip || null]
    );
    const userResult = await client.query(
      `SELECT u.id, u.display_name, pc.password_hash
       FROM users u
       LEFT JOIN partner_credentials pc ON pc.user_id = u.id
       WHERE u.phone_e164 = $1 AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM partner_members pm
           JOIN partners p ON p.id = pm.partner_id
           WHERE pm.user_id = u.id AND pm.status = 'ACTIVE'
             AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
         )
       FOR UPDATE OF u`,
      [phone]
    );
    const user = userResult.rows[0];
    const passwordMatches = await bcrypt.compare(password, user?.password_hash || await getDummyPasswordHash()).catch(() => false);
    if (!user || !user.password_hash || !passwordMatches) {
      await client.query("COMMIT");
      return res.status(401).json({ success: false, message: "Invalid mobile number or password." });
    }
    const session = await createPartnerSession(client, req, user.id, secret);
    await client.query("COMMIT");
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, ...session });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Partner password login failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to sign in." });
  } finally {
    client?.release();
  }
}

async function setPartnerPassword(req, res) {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (Buffer.byteLength(password, "utf8") < 12 || Buffer.byteLength(password, "utf8") > 128) {
    return res.status(400).json({ success: false, message: "Password must be 12 to 128 bytes long." });
  }
  const inviteId = req.authClaims?.partner_invite_id;
  const invitePurpose = req.authClaims?.partner_invite_purpose;
  if (typeof inviteId !== "string" || !["SETUP", "RESET"].includes(invitePurpose)) {
    return res.status(403).json({ success: false, message: "A verified, one-time partner invitation is required to set a password." });
  }

  let client;
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    client = await db.connect();
    await client.query("BEGIN");
    const invite = await client.query(
      `SELECT id FROM partner_invites
       WHERE id = $1 AND user_id = $2 AND purpose = $3
         AND consumed_at IS NOT NULL AND password_set_at IS NULL
       FOR UPDATE`,
      [inviteId, req.user.id, invitePurpose]
    );
    if (!invite.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "This password setup invitation has already been used." });
    }
    const before = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM partner_credentials WHERE user_id = $1
       ) AS has_password
       FROM users WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL FOR UPDATE`,
      [req.user.id]
    );
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(401).json({ success: false, message: "Authentication required." });
    }
    await client.query(
      `INSERT INTO partner_credentials (user_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [req.user.id, passwordHash]
    );
    await client.query("UPDATE partner_invites SET password_set_at = now() WHERE id = $1", [inviteId]);
    await writeAuditLog(client, req, "partner.password_set", "users", req.user.id,
      { has_password: before.rows[0].has_password }, { has_password: true, purpose: invitePurpose });
    await client.query("COMMIT");
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, message: "Partner password saved." });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Partner password setup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to save partner password." });
  } finally {
    client?.release();
  }
}

async function logoutPartner(req, res) {
  try {
    await db.query(
      `UPDATE user_sessions
       SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [req.user.session_id, req.user.id]
    );
    return res.json({ success: true });
  } catch (error) {
    console.error("Partner sign-out failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to sign out." });
  }
}

module.exports = {
  requestPartnerInviteOtp,
  verifyPartnerInviteOtp,
  loginPartnerWithPassword,
  setPartnerPassword,
  logoutPartner
};
