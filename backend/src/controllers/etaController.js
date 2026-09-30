"use strict";

const db = require("../config/db");
const { writeAuditLog } = require("../services/auditService");
const { ETA_CONFIG_SETTING_KEY, DEFAULT_ETA_CONFIG, normalizeEtaConfig } = require("../services/etaService");

function respondError(res, status, message) {
  return res.status(status).json({ success: false, message, data: null });
}

async function getAdminEtaConfig(req, res) {
  try {
    const result = await db.query(
      `SELECT setting_value, updated_at
       FROM app_settings
       WHERE setting_key = $1 AND is_public = false`,
      [ETA_CONFIG_SETTING_KEY]
    );
    const setting = result.rows[0] || null;
    const config = setting ? normalizeEtaConfig(setting.setting_value) : { ...DEFAULT_ETA_CONFIG };
    return res.json({ success: true, data: { ...config, configured: Boolean(setting), updated_at: setting?.updated_at || null } });
  } catch (error) {
    console.error("ETA configuration read failed:", error.message);
    return respondError(res, 500, "Unable to retrieve ETA configuration.");
  }
}

async function updateAdminEtaConfig(req, res) {
  let config;
  try {
    config = normalizeEtaConfig({
      version: 1,
      average_delivery_speed_kmh: req.body?.average_delivery_speed_kmh,
      preparation_buffer_minutes: req.body?.preparation_buffer_minutes,
      minimum_eta_minutes: req.body?.minimum_eta_minutes,
      maximum_eta_buffer_minutes: req.body?.maximum_eta_buffer_minutes
    });
  } catch (error) {
    return respondError(res, 400, error.message);
  }

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const beforeResult = await client.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = $1",
      [ETA_CONFIG_SETTING_KEY]
    );
    const before = beforeResult.rows[0] ? normalizeEtaConfig(beforeResult.rows[0].setting_value) : null;
    await client.query(
      `INSERT INTO app_settings (setting_key, setting_value, description, is_public, updated_by_user_id)
       VALUES ($1, $2::jsonb, 'Provider-independent delivery ETA estimation settings.', false, $3)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           description = EXCLUDED.description,
           is_public = false,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = now()`,
      [ETA_CONFIG_SETTING_KEY, JSON.stringify(config), req.admin.id]
    );
    await writeAuditLog(client, req, "delivery_eta_config.updated", "app_settings", null, before, config);
    await client.query("COMMIT");
    return res.json({ success: true, data: config });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("ETA configuration update failed:", error.message);
    return respondError(res, 500, "Unable to update ETA configuration.");
  } finally {
    client?.release();
  }
}

module.exports = { getAdminEtaConfig, updateAdminEtaConfig };
