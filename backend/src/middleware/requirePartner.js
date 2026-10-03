const db = require("../config/db");
const { requireAuth } = require("./requireAuth");

const PARTNER_ACCESS_TOKEN_USES = new Set(["partner_access"]);

async function requirePartner(req, res, next) {
  return requireAuth(req, res, async () => {
    try {
      const result = await db.query(
        `SELECT p.id AS partner_id, p.display_name, p.business_type, pm.member_role,
                EXISTS (SELECT 1 FROM partner_credentials pc WHERE pc.user_id = $1) AS has_password
         FROM partner_members pm
         JOIN partners p ON p.id = pm.partner_id
         WHERE pm.user_id = $1
           AND pm.status = 'ACTIVE'
           AND p.status = 'ACTIVE'
           AND p.deleted_at IS NULL
         ORDER BY p.display_name ASC, p.id ASC`,
        [req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({ success: false, message: "Active partner membership required." });
      }

      req.partnerMemberships = result.rows;
      req.partnerIds = result.rows.map(row => row.partner_id);
      req.user.has_password = result.rows[0].has_password;
      return next();
    } catch (error) {
      console.error("Partner authorization failed:", error.message);
      return res.status(500).json({ success: false, message: "Unable to authorize partner request." });
    }
  }, PARTNER_ACCESS_TOKEN_USES);
}

function requirePartnerPassword(req, res, next) {
  if (req.user?.has_password) return next();
  return res.status(403).json({
    success: false,
    message: "Set a partner password to continue.",
    code: "PARTNER_PASSWORD_SETUP_REQUIRED"
  });
}

module.exports = { requirePartner, requirePartnerPassword };