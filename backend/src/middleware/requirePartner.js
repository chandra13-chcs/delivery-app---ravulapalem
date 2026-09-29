const db = require("../config/db");
const { requireAuth } = require("./requireAuth");

async function requirePartner(req, res, next) {
  return requireAuth(req, res, async () => {
    try {
      const result = await db.query(
        `SELECT p.id AS partner_id, p.display_name, p.business_type, pm.member_role
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
      return next();
    } catch (error) {
      console.error("Partner authorization failed:", error.message);
      return res.status(500).json({ success: false, message: "Unable to authorize partner request." });
    }
  });
}

module.exports = { requirePartner };