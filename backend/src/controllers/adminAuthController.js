const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

const ACCESS_TOKEN_LIFETIME = "15m";
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_NAME = "myshopzy_admin_refresh";
const JWT_ISSUER = "myshopzy-api";
const JWT_AUDIENCE = "myshopzy-admin";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{80,100}$/;

function getSigningSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32
    ? secret
    : null;
}

function sendAuthUnavailable(res) {
  return res.status(503).json({
    success: false,
    message: "Admin authentication is unavailable."
  });
}

function createAccessToken(userId, secret) {
  return jwt.sign(
    { token_use: "admin_access" },
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

function createRefreshToken() {
  return crypto.randomBytes(64).toString("base64url");
}

function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest();
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/admin/auth",
    maxAge: REFRESH_TOKEN_LIFETIME_MS
  };
}

function readRefreshCookie(req) {
  const cookieHeader = req.headers.cookie || "";
  const entry = cookieHeader.split(";").map(value => value.trim())
    .find(value => value.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!entry) return "";

  try {
    return decodeURIComponent(entry.slice(REFRESH_COOKIE_NAME.length + 1));
  } catch {
    return "";
  }
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
}

function publicAdmin(user) {
  return {
    id: user.id,
    display_name: user.display_name,
    employee_code: user.employee_code
  };
}

function validateLoginBody(body) {
  const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const isValidIdentifier = identifier.length <= 254
    && (EMAIL_PATTERN.test(identifier) || PHONE_PATTERN.test(identifier));
  const isValidPassword = password.length > 0 && Buffer.byteLength(password, "utf8") <= 1024;

  return isValidIdentifier && isValidPassword ? { identifier, password } : null;
}

async function createRefreshSession(queryable, userId, req, refreshToken) {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS);
  const userAgent = typeof req.get("user-agent") === "string"
    ? req.get("user-agent").slice(0, 512)
    : null;

  await queryable.query(
    `INSERT INTO user_sessions (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashRefreshToken(refreshToken), userAgent, req.ip || null, expiresAt]
  );
}

function sendLoginResponse(res, user, accessToken, refreshToken) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  res.set("Cache-Control", "no-store");
  return res.json({
    success: true,
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 900,
    admin: publicAdmin(user)
  });
}

async function loginAdmin(req, res) {
  const credentials = validateLoginBody(req.body);
  if (!credentials) {
    return res.status(400).json({ success: false, message: "Invalid login request." });
  }

  const secret = getSigningSecret();
  if (!secret) return sendAuthUnavailable(res);

  try {
    const result = await db.query(
      `SELECT u.id, u.password_hash, u.display_name, au.employee_code
       FROM users u
       JOIN admin_users au ON au.user_id = u.id
       WHERE (lower(u.email) = lower($1) OR u.phone_e164 = $1)
         AND u.status = 'ACTIVE'
         AND u.deleted_at IS NULL
         AND au.status = 'ACTIVE'
       LIMIT 1`,
      [credentials.identifier]
    );

    const user = result.rows[0];
    let passwordMatches = false;
    if (user?.password_hash) {
      try {
        passwordMatches = await bcrypt.compare(credentials.password, user.password_hash);
      } catch {
        passwordMatches = false;
      }
    }

    if (!user || !passwordMatches) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    const accessToken = createAccessToken(user.id, secret);
    const refreshToken = createRefreshToken();
    await createRefreshSession(db, user.id, req, refreshToken);
    return sendLoginResponse(res, user, accessToken, refreshToken);
  } catch (error) {
    console.error("Admin login failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to sign in." });
  }
}

async function refreshAdminSession(req, res) {
  const secret = getSigningSecret();
  if (!secret) return sendAuthUnavailable(res);

  const currentRefreshToken = readRefreshCookie(req);
  if (!REFRESH_TOKEN_PATTERN.test(currentRefreshToken)) {
    clearRefreshCookie(res);
    return res.status(401).json({ success: false, message: "Invalid or expired session." });
  }

  let client;
  let transactionOpen = false;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    transactionOpen = true;

    const sessionResult = await client.query(
      `SELECT id, user_id
       FROM user_sessions
       WHERE refresh_token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > now()
       FOR UPDATE`,
      [hashRefreshToken(currentRefreshToken)]
    );
    const session = sessionResult.rows[0];
    if (!session) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: "Invalid or expired session." });
    }

    const userResult = await client.query(
      `SELECT u.id, u.display_name, au.employee_code
       FROM users u
       JOIN admin_users au ON au.user_id = u.id
       WHERE u.id = $1
         AND u.status = 'ACTIVE'
         AND u.deleted_at IS NULL
         AND au.status = 'ACTIVE'`,
      [session.user_id]
    );
    const user = userResult.rows[0];
    if (!user) {
      await client.query(
        "UPDATE user_sessions SET revoked_at = now(), last_used_at = now() WHERE id = $1 AND revoked_at IS NULL",
        [session.id]
      );
      await client.query("COMMIT");
      transactionOpen = false;
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: "Invalid or expired session." });
    }

    const accessToken = createAccessToken(user.id, secret);
    const nextRefreshToken = createRefreshToken();
    await client.query(
      "UPDATE user_sessions SET revoked_at = now(), last_used_at = now() WHERE id = $1 AND revoked_at IS NULL",
      [session.id]
    );
    await createRefreshSession(client, user.id, req, nextRefreshToken);
    await client.query("COMMIT");
    transactionOpen = false;

    return sendLoginResponse(res, user, accessToken, nextRefreshToken);
  } catch (error) {
    if (client && transactionOpen) await client.query("ROLLBACK").catch(() => {});
    console.error("Admin session refresh failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to refresh session." });
  } finally {
    client?.release();
  }
}

async function logoutAdmin(req, res) {
  const refreshToken = readRefreshCookie(req);
  if (REFRESH_TOKEN_PATTERN.test(refreshToken)) {
    try {
      await db.query(
        `UPDATE user_sessions
         SET revoked_at = now(), last_used_at = now()
         WHERE refresh_token_hash = $1 AND revoked_at IS NULL`,
        [hashRefreshToken(refreshToken)]
      );
    } catch (error) {
      console.error("Admin logout failed:", error.message);
      return res.status(500).json({ success: false, message: "Unable to sign out." });
    }
  }

  clearRefreshCookie(res);
  return res.status(204).end();
}

async function getCurrentAdmin(req, res) {
  res.set("Cache-Control", "no-store");
  return res.json({ success: true, admin: publicAdmin(req.admin) });
}

module.exports = {
  loginAdmin,
  refreshAdminSession,
  logoutAdmin,
  getCurrentAdmin
};
