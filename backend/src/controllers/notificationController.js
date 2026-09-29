"use strict";

const db = require("../config/db");
const { resolveApprovedRider } = require("./deliveryController");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidNotificationId(res) {
  return res.status(400).json({ success: false, message: "Invalid notification id.", data: null });
}

function notificationResponse(res, result) {
  return res.json({ success: true, data: result.rows });
}

async function listUserNotifications(req, res) {
  try {
    const result = await db.query(
      `SELECT id, channel, status, title, body, payload, created_at, read_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [req.user.id]
    );
    return notificationResponse(res, result);
  } catch (error) {
    console.error("Notification listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve notifications.", data: null });
  }
}

async function markUserNotificationRead(req, res) {
  const { notificationId } = req.params;
  if (!UUID_PATTERN.test(notificationId)) return invalidNotificationId(res);
  try {
    const result = await db.query(
      `UPDATE notifications
       SET status = 'READ', read_at = COALESCE(read_at, now()), updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, status, read_at`,
      [notificationId, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Notification not found.", data: null });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Notification read update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update notification.", data: null });
  }
}

async function markAllUserNotificationsRead(req, res) {
  try {
    const result = await db.query(
      `UPDATE notifications
       SET status = 'READ', read_at = COALESCE(read_at, now()), updated_at = now()
       WHERE user_id = $1 AND read_at IS NULL
       RETURNING id`,
      [req.user.id]
    );
    return res.json({ success: true, data: { updated_count: result.rowCount } });
  } catch (error) {
    console.error("Bulk notification read update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update notifications.", data: null });
  }
}

async function listPartnerNotifications(req, res) {
  try {
    const result = await db.query(
      `SELECT id, channel, status, title, body, payload, created_at, read_at
       FROM notifications
       WHERE user_id = $1
         AND payload->>'recipient_type' = 'PARTNER'
         AND payload->>'partner_id' = ANY($2::text[])
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [req.user.id, req.partnerIds]
    );
    return notificationResponse(res, result);
  } catch (error) {
    console.error("Partner notification listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve partner notifications.", data: null });
  }
}

async function markPartnerNotificationRead(req, res) {
  const { notificationId } = req.params;
  if (!UUID_PATTERN.test(notificationId)) return invalidNotificationId(res);
  try {
    const result = await db.query(
      `UPDATE notifications
       SET status = 'READ', read_at = COALESCE(read_at, now()), updated_at = now()
       WHERE id = $1 AND user_id = $2
         AND payload->>'recipient_type' = 'PARTNER'
         AND payload->>'partner_id' = ANY($3::text[])
       RETURNING id, status, read_at`,
      [notificationId, req.user.id, req.partnerIds]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Notification not found.", data: null });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Partner notification read update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update notification.", data: null });
  }
}

async function listRiderNotifications(req, res) {
  const rider = await resolveApprovedRider(req.user.id).catch(error => {
    console.error("Rider notification authorization failed:", error.message);
    return null;
  });
  if (!rider) return res.status(403).json({ success: false, message: "An approved rider profile is required.", data: null });
  try {
    const result = await db.query(
      `SELECT id, channel, status, title, body, payload, created_at, read_at
       FROM notifications
       WHERE user_id = $1 AND payload->>'recipient_type' = 'RIDER'
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [req.user.id]
    );
    return notificationResponse(res, result);
  } catch (error) {
    console.error("Rider notification listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve rider notifications.", data: null });
  }
}

async function markRiderNotificationRead(req, res) {
  const { notificationId } = req.params;
  if (!UUID_PATTERN.test(notificationId)) return invalidNotificationId(res);
  const rider = await resolveApprovedRider(req.user.id).catch(error => {
    console.error("Rider notification authorization failed:", error.message);
    return null;
  });
  if (!rider) return res.status(403).json({ success: false, message: "An approved rider profile is required.", data: null });
  try {
    const result = await db.query(
      `UPDATE notifications
       SET status = 'READ', read_at = COALESCE(read_at, now()), updated_at = now()
       WHERE id = $1 AND user_id = $2 AND payload->>'recipient_type' = 'RIDER'
       RETURNING id, status, read_at`,
      [notificationId, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Notification not found.", data: null });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Rider notification read update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update notification.", data: null });
  }
}

async function markAllRiderNotificationsRead(req, res) {
  const rider = await resolveApprovedRider(req.user.id).catch(error => {
    console.error("Rider notification authorization failed:", error.message);
    return null;
  });
  if (!rider) return res.status(403).json({ success: false, message: "An approved rider profile is required.", data: null });
  try {
    const result = await db.query(
      `UPDATE notifications
       SET status = 'READ', read_at = COALESCE(read_at, now()), updated_at = now()
       WHERE user_id = $1 AND payload->>'recipient_type' = 'RIDER' AND read_at IS NULL
       RETURNING id`,
      [req.user.id]
    );
    return res.json({ success: true, data: { updated_count: result.rowCount } });
  } catch (error) {
    console.error("Rider notification read update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update notifications.", data: null });
  }
}

async function listAdminNotifications(req, res) {
  try {
    const result = await db.query(
      `SELECT id, channel, status, title, body, payload, created_at, read_at
       FROM notifications
       WHERE user_id = $1 AND payload->>'recipient_type' = 'ADMIN'
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [req.admin.id]
    );
    return notificationResponse(res, result);
  } catch (error) {
    console.error("Admin notification listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve admin notifications.", data: null });
  }
}

async function markAdminNotificationRead(req, res) {
  const { notificationId } = req.params;
  if (!UUID_PATTERN.test(notificationId)) return invalidNotificationId(res);
  try {
    const result = await db.query(
      `UPDATE notifications
       SET status = 'READ', read_at = COALESCE(read_at, now()), updated_at = now()
       WHERE id = $1 AND user_id = $2 AND payload->>'recipient_type' = 'ADMIN'
       RETURNING id, status, read_at`,
      [notificationId, req.admin.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Notification not found.", data: null });
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Admin notification read update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update notification.", data: null });
  }
}

module.exports = {
  listUserNotifications,
  markUserNotificationRead,
  markAllUserNotificationsRead,
  listPartnerNotifications,
  markPartnerNotificationRead,
  listRiderNotifications,
  markRiderNotificationRead,
  markAllRiderNotificationsRead,
  listAdminNotifications,
  markAdminNotificationRead
};
