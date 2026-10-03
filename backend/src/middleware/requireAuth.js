const jwt = require("jsonwebtoken");
const db = require("../config/db");

const JWT_ISSUER = "myshopzy-api";
const JWT_AUDIENCE = "myshopzy-admin";
const ACCESS_TOKEN_USES = new Set(["admin_access", "user_access"]);
const USER_ACCESS_ONLY = new Set(["user_access"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function verifyAccessToken(req, allowedTokenUses = ACCESS_TOKEN_USES) {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    return { error: { status: 503, message: "Authentication is unavailable." } };
  }

  const authorization = typeof req.get === "function"
    ? req.get("authorization") || ""
    : req.headers?.authorization || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match) {
    return { error: { status: 401, message: "Authentication required." } };
  }

  try {
    const claims = jwt.verify(match[1], secret, {
      algorithms: ["HS256"],
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER
    });
    if (!allowedTokenUses.has(claims.token_use) || typeof claims.sub !== "string") {
      return { error: { status: 401, message: "Invalid or expired access token." } };
    }
    return { claims };
  } catch {
    return { error: { status: 401, message: "Invalid or expired access token." } };
  }
}

function sendAuthenticationError(res, error) {
  return res.status(error.status).json({ success: false, message: error.message });
}

async function requireAuth(req, res, next, allowedTokenUses = ACCESS_TOKEN_USES) {
  const verification = verifyAccessToken(req, allowedTokenUses);
  if (verification.error) return sendAuthenticationError(res, verification.error);

  try {
    const result = await db.query(
      `SELECT id, display_name, password_hash IS NOT NULL AS has_password
       FROM users
       WHERE id = $1
         AND status = 'ACTIVE'
         AND deleted_at IS NULL`,
      [verification.claims.sub]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid or expired access token." });
    }

    if (["user_access", "partner_access"].includes(verification.claims.token_use)) {
      if (typeof verification.claims.sid !== "string" || !UUID_PATTERN.test(verification.claims.sid)) {
        return res.status(401).json({ success: false, message: "Invalid or expired access token." });
      }
      const sessionResult = await db.query(
        `SELECT id
         FROM user_sessions
         WHERE id = $1
           AND user_id = $2
           AND revoked_at IS NULL
           AND expires_at > now()`,
        [verification.claims.sid, user.id]
      );
      if (!sessionResult.rows[0]) {
        return res.status(401).json({ success: false, message: "Invalid or expired access token." });
      }
    }

    req.user = {
      id: user.id,
      display_name: user.display_name,
      has_password: user.has_password,
      ...(["user_access", "partner_access"].includes(verification.claims.token_use)
        ? { session_id: verification.claims.sid }
        : {})
    };
    req.authClaims = verification.claims;
    return next();
  } catch (error) {
    console.error("Authentication failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to authenticate request." });
  }
}

function requireUserAuth(req, res, next) {
  return requireAuth(req, res, next, USER_ACCESS_ONLY);
}

module.exports = { requireAuth, requireUserAuth, verifyAccessToken, sendAuthenticationError };