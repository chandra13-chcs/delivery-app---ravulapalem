"use strict";

const db = require("../config/db");
const { writeAuditLog } = require("../services/auditService");
const {
  RIDER_EARNING_SETTING_KEY,
  DEFAULT_RIDER_EARNING_CONFIG,
  normalizeRiderEarningConfig,
  validateRiderEarningSnapshot
} = require("../services/riderEarningsService");

function respondError(res, status, message) {
  return res.status(status).json({ success: false, message, data: null });
}

function parseAdminConfig(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("A rider earning configuration object is required.");
  }
  return normalizeRiderEarningConfig({
    version: 1,
    currency: "INR",
    base_earning_inr: body.base_earning_inr,
    rain_surge_inr: body.rain_surge_inr,
    rain_surge_active: body.rain_surge_active
  });
}

async function getAdminRiderEarningConfig(req, res) {
  try {
    const result = await db.query(
      `SELECT setting_value, updated_at
       FROM app_settings
       WHERE setting_key = $1 AND is_public = false`,
      [RIDER_EARNING_SETTING_KEY]
    );
    const setting = result.rows[0] || null;
    const config = setting ? normalizeRiderEarningConfig(setting.setting_value) : { ...DEFAULT_RIDER_EARNING_CONFIG };
    return res.json({ success: true, data: { ...config, configured: Boolean(setting), updated_at: setting?.updated_at || null } });
  } catch (error) {
    console.error("Rider earning configuration read failed:", error.message);
    return respondError(res, 500, "Unable to retrieve rider earning configuration.");
  }
}

async function updateAdminRiderEarningConfig(req, res) {
  let config;
  try {
    config = parseAdminConfig(req.body);
  } catch (error) {
    return respondError(res, 400, error.message);
  }

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const beforeResult = await client.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = $1",
      [RIDER_EARNING_SETTING_KEY]
    );
    const before = beforeResult.rows[0]
      ? normalizeRiderEarningConfig(beforeResult.rows[0].setting_value)
      : null;
    await client.query(
      `INSERT INTO app_settings (setting_key, setting_value, description, is_public, updated_by_user_id)
       VALUES ($1, $2::jsonb, 'Server-authoritative rider earning rules; customer totals are unaffected.', false, $3)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           description = EXCLUDED.description,
           is_public = false,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = now()` ,
      [RIDER_EARNING_SETTING_KEY, JSON.stringify(config), req.admin.id]
    );
    await writeAuditLog(client, req, "rider_earning_config.updated", "app_settings", null, before, config);
    await client.query("COMMIT");
    return res.json({ success: true, data: config });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Rider earning configuration update failed:", error.message);
    return respondError(res, 500, "Unable to update rider earning configuration.");
  } finally {
    client?.release();
  }
}

async function getRiderEarnings(req, res) {
  try {
    const riderResult = await db.query(
      `SELECT id
       FROM riders
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [req.user.id]
    );
    const rider = riderResult.rows[0];
    if (!rider) return respondError(res, 404, "Rider profile not found.");

    const result = await db.query(
      `SELECT completed.assignment_id, completed.order_number, completed.completed_at,
              completed.earning_snapshot
       FROM (
         SELECT DISTINCT ON (da.id)
                da.id AS assignment_id, o.order_number, da.completed_at,
                dt.details->'rider_earning' AS earning_snapshot,
                dt.occurred_at, dt.id AS tracking_id
         FROM delivery_assignments da
         JOIN orders o ON o.id = da.order_id
         JOIN delivery_tracking dt ON dt.assignment_id = da.id
         WHERE da.rider_id = $1
           AND da.status = 'COMPLETED'
           AND o.status = 'DELIVERED'
           AND dt.event_type = 'DELIVERED'
           AND jsonb_typeof(dt.details->'rider_earning') = 'object'
         ORDER BY da.id, dt.occurred_at DESC, dt.id DESC
       ) completed
       ORDER BY completed.completed_at DESC NULLS LAST, completed.assignment_id DESC`,
      [rider.id]
    );

    const deliveries = result.rows.map(row => ({
      assignment_id: row.assignment_id,
      order_number: row.order_number,
      completed_at: row.completed_at,
      ...validateRiderEarningSnapshot(row.earning_snapshot)
    }));
    const totalCents = deliveries.reduce((sum, delivery) => sum + Math.round(delivery.total_earning_inr * 100), 0);
    return res.json({
      success: true,
      data: {
        currency: "INR",
        completed_count: deliveries.length,
        total_earnings_inr: totalCents / 100,
        deliveries
      }
    });
  } catch (error) {
    console.error("Rider earnings lookup failed:", error.message);
    return respondError(res, 500, "Unable to retrieve rider earnings.");
  }
}

module.exports = {
  getAdminRiderEarningConfig,
  updateAdminRiderEarningConfig,
  getRiderEarnings
};
