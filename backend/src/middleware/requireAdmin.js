const jwt = require("jsonwebtoken");
const db = require("../config/db");

const JWT_ISSUER = "myshopzy-api";
const JWT_AUDIENCE = "myshopzy-admin";

function getSigningSecret() {
  const secret = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET;
  return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32
    ? secret
    : null;
}

async function requireAdmin(req, res, next) {
  const secret = getSigningSecret();
  if (!secret) {
    return res.status(503).json({ success: false, message: "Admin authentication is unavailable." });
  }

  const authorization = req.get("authorization") || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }

  let claims;
  try {
    claims = jwt.verify(match[1], secret, {
      algorithms: ["HS256"],
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER
    });
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired access token." });
  }

  if (claims.token_use !== "admin_access" || typeof claims.sub !== "string") {
    return res.status(401).json({ success: false, message: "Invalid or expired access token." });
  }

  try {
    const result = await db.query(
      `SELECT u.id, u.display_name, au.employee_code
       FROM users u
       JOIN admin_users au ON au.user_id = u.id
       WHERE u.id = $1
         AND u.status = 'ACTIVE'
         AND u.deleted_at IS NULL
         AND au.status = 'ACTIVE'`,
      [claims.sub]
    );
    if (!result.rows[0]) {
      return res.status(401).json({ success: false, message: "Admin access is no longer active." });
    }

    req.admin = result.rows[0];
    return next();
  } catch (error) {
    console.error("Admin authorization failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to authorize request." });
  }
}

function requirePermission(permissionCode) {
  if (typeof permissionCode !== "string" || !/^[a-z][a-z0-9:_-]{1,99}$/.test(permissionCode)) {
    throw new TypeError("A valid permission code is required.");
  }

  return async function permissionMiddleware(req, res, next) {
    if (!req.admin?.id) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    try {
      const result = await db.query(
        `SELECT EXISTS (
           SELECT 1
           FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id
           WHERE ur.user_id = $1 AND p.code = $2
         ) AS has_permission`,
        [req.admin.id, permissionCode]
      );
      if (!result.rows[0]?.has_permission) {
        return res.status(403).json({ success: false, message: "Permission denied." });
      }
      return next();
    } catch (error) {
      console.error("Admin permission check failed:", error.message);
      return res.status(500).json({ success: false, message: "Unable to authorize request." });
    }
  };
}

module.exports = { requireAdmin, requirePermission };
