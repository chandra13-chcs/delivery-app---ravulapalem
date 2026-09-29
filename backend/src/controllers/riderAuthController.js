"use strict";

const db = require("../config/db");

async function getRiderIdentity(req, res) {
  try {
    const result = await db.query(
      `SELECT r.id AS rider_id, r.verification_status, r.is_available, r.approved_at,
              u.id AS user_id, u.display_name, u.phone_e164, u.email
       FROM riders r
       JOIN users u ON u.id = r.user_id
       WHERE r.user_id = $1
         AND r.deleted_at IS NULL
         AND u.status = 'ACTIVE'
         AND u.deleted_at IS NULL`,
      [req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Rider profile not found.", data: null });
    }

    const rider = result.rows[0];
    res.set("Cache-Control", "no-store");
    return res.json({
      success: true,
      data: {
        user: { id: rider.user_id, display_name: rider.display_name, phone_e164: rider.phone_e164, email: rider.email },
        rider: { id: rider.rider_id, verification_status: rider.verification_status, is_available: rider.is_available, approved_at: rider.approved_at }
      }
    });
  } catch (error) {
    console.error("Rider identity lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve rider identity.", data: null });
  }
}

module.exports = { getRiderIdentity };
