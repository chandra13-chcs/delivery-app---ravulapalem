"use strict";

const db = require("../config/db");

const VALID_ADMIN_VERIFICATION_STATUSES = new Set(["PENDING", "SUBMITTED", "APPROVED", "REJECTED", "SUSPENDED"]);
const VALID_ADMIN_TRANSITIONS = {
  PENDING: new Set(["APPROVED", "REJECTED"]),
  SUBMITTED: new Set(["APPROVED", "REJECTED"]),
  APPROVED: new Set(["REJECTED", "SUSPENDED"]),
  REJECTED: new Set(["APPROVED", "SUSPENDED"]),
  SUSPENDED: new Set(["APPROVED", "REJECTED"])
};

function valueText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeRiderForAdmin(rider, user, documents) {
  const docMap = {};
  for (const document of documents || []) {
    docMap[document.document_type] = document;
  }

  return {
    id: rider.id,
    name: user?.display_name || null,
    mobile: user?.phone_e164 || null,
    email: user?.email || null,
    verification_status: rider.verification_status,
    is_available: Boolean(rider.is_available),
    vehicle_type: rider.vehicle_type || null,
    vehicle_registration: rider.vehicle_registration || null,
    license_number_last4: rider.license_number_last4 || null,
    approved_at: rider.approved_at || null,
    approved_by_user_id: rider.approved_by_user_id || null,
    created_at: rider.created_at || null,
    updated_at: rider.updated_at || null,
    selfie_path: docMap.SELFIE?.object_key || null,
    selfie_file: docMap.SELFIE?.original_filename || null,
    aadhaar_path: docMap.AADHAAR?.object_key || null,
    aadhaar_file: docMap.AADHAAR?.original_filename || null,
    pan_path: docMap.PAN?.object_key || null,
    pan_file: docMap.PAN?.original_filename || null
  };
}

async function listAdminRiders(req, res) {
  try {
    const result = await db.query(
      `SELECT r.*, u.display_name, u.phone_e164, u.email
       FROM riders r
       JOIN users u ON u.id = r.user_id
       WHERE r.deleted_at IS NULL
       ORDER BY r.created_at DESC`
    );

    const riders = result.rows;
    if (!riders.length) {
      return res.json({ success: true, data: [] });
    }

    const riderIds = riders.map((rider) => rider.id);
    const documentResult = await db.query(
      `SELECT *
       FROM rider_documents
       WHERE rider_id = ANY($1)
       ORDER BY created_at DESC`,
      [riderIds]
    );

    const documentsByRider = {};
    for (const row of documentResult.rows) {
      if (!documentsByRider[row.rider_id]) documentsByRider[row.rider_id] = [];
      documentsByRider[row.rider_id].push(row);
    }

    const entries = riders.map((rider) => safeRiderForAdmin(rider, {
      display_name: rider.display_name,
      phone_e164: rider.phone_e164,
      email: rider.email
    }, documentsByRider[rider.id] || []));

    return res.json({ success: true, data: entries });
  } catch (error) {
    console.error("Admin rider listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to list rider verification records.", data: null });
  }
}

async function verifyRider(req, res) {
  const riderId = req.params.riderId;
  const requestedStatus = valueText(req.body?.verification_status || req.body?.status).toUpperCase();
  const reviewReason = typeof req.body?.review_reason === "string" ? req.body.review_reason.trim() : null;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(riderId)) {
    return res.status(400).json({ success: false, message: "Invalid rider id." });
  }

  if (!VALID_ADMIN_VERIFICATION_STATUSES.has(requestedStatus)) {
    return res.status(400).json({ success: false, message: "Verification status must be APPROVED or REJECTED." });
  }

  if (!VALID_ADMIN_TRANSITIONS["PENDING"] && !VALID_ADMIN_TRANSITIONS["SUBMITTED"] && !VALID_ADMIN_TRANSITIONS["APPROVED"] && !VALID_ADMIN_TRANSITIONS["REJECTED"] && !VALID_ADMIN_TRANSITIONS["SUSPENDED"]) {
    return res.status(500).json({ success: false, message: "Verification policy is unavailable." });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const riderResult = await client.query(
      `SELECT r.*, u.display_name, u.phone_e164, u.email
       FROM riders r
       JOIN users u ON u.id = r.user_id
       WHERE r.id = $1 AND r.deleted_at IS NULL
       FOR UPDATE`,
      [riderId]
    );

    const rider = riderResult.rows[0];
    if (!rider) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Rider record not found." });
    }

    const currentStatus = rider.verification_status;
    const allowedStatuses = VALID_ADMIN_TRANSITIONS[currentStatus] || new Set();
    if (!allowedStatuses.has(requestedStatus)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: `A rider in ${currentStatus} status cannot be moved to ${requestedStatus}.`
      });
    }

    const beforeData = {
      id: rider.id,
      verification_status: rider.verification_status,
      approved_by_user_id: rider.approved_by_user_id,
      approved_at: rider.approved_at,
      is_available: rider.is_available
    };

    const updateValues = [requestedStatus, req.admin.id, rider.id];
    let updateClause = `verification_status = $1, approved_by_user_id = $2, updated_at = now(), is_available = false`;

    if (requestedStatus === "APPROVED") {
      updateClause += ", approved_at = now()";
    }

    const updatedResult = await client.query(
      `UPDATE riders
       SET ${updateClause}
       WHERE id = $3
       RETURNING *`,
      updateValues
    );

    const afterData = {
      id: updatedResult.rows[0].id,
      verification_status: updatedResult.rows[0].verification_status,
      approved_by_user_id: updatedResult.rows[0].approved_by_user_id,
      approved_at: updatedResult.rows[0].approved_at,
      is_available: updatedResult.rows[0].is_available
    };

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.admin.id, "rider_verification.updated", "riders", rider.id, beforeData, afterData, req.headers["x-request-id"] || null]
    );

    await client.query("COMMIT");

    if (reviewReason && reviewReason.length > 0) {
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data, request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.admin.id, "rider_verification.reason", "riders", rider.id, { reason: reviewReason }, { reason: reviewReason }, req.headers["x-request-id"] || null]
      );
    }

    return res.json({
      success: true,
      message: `Rider verification status updated to ${requestedStatus}.`,
      data: safeRiderForAdmin(updatedResult.rows[0], {
        display_name: rider.display_name,
        phone_e164: rider.phone_e164,
        email: rider.email
      }, [])
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Admin rider verification update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update rider verification status.", data: null });
  } finally {
    client.release();
  }
}

module.exports = {
  listAdminRiders,
  verifyRider
};
