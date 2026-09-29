"use strict";

const db = require("../config/db");

const VALID_RIDER_STATUSES = new Set([
  "PENDING",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "EXPIRED"
]);

const VALID_DOCUMENT_TYPES = new Set([
  "SELFIE",
  "AADHAAR",
  "PAN",
  "DRIVING_LICENSE",
  "PASSPORT",
  "VEHICLE_RC"
]);

function valueText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(value, fallback = "PENDING") {
  const status = valueText(value).toUpperCase();
  return VALID_RIDER_STATUSES.has(status) ? status : fallback;
}

function normalizeDocumentType(value) {
  const documentType = valueText(value).toUpperCase();
  if (!VALID_DOCUMENT_TYPES.has(documentType)) {
    return null;
  }
  return documentType;
}

function safeRiderRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    verification_status: row.verification_status,
    is_available: Boolean(row.is_available),
    vehicle_type: row.vehicle_type || null,
    vehicle_registration: row.vehicle_registration || null,
    license_number_last4: row.license_number_last4 || null,
    approved_at: row.approved_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

function safeDocumentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    rider_id: row.rider_id,
    document_type: row.document_type,
    object_key: row.object_key,
    original_filename: row.original_filename || null,
    content_type: row.content_type || null,
    verification_status: row.verification_status,
    reviewed_by_user_id: row.reviewed_by_user_id || null,
    reviewed_at: row.reviewed_at || null,
    expires_at: row.expires_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function getRiderByUserId(userId, client = db) {
  const result = await client.query(
    `SELECT r.*
     FROM riders r
     WHERE r.user_id = $1
       AND r.deleted_at IS NULL
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function getRiderUserProfile(userId) {
  const result = await db.query(
    `SELECT id, display_name, phone_e164, email
     FROM users
     WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
    [userId]
  );
  return result.rows[0] || null;
}

async function createRiderApplication(req, res) {
  const userId = req.user.id;
  const body = req.body || {};

  const vehicleType = valueText(body.vehicle_type || body.vehicleType);
  const vehicleRegistration = valueText(body.vehicle_registration || body.vehicle_number || body.vehicleRegistration);
  const licenseLast4 = valueText(body.license_last4 || body.license_number_last4 || body.licenseLast4);

  if (vehicleType && vehicleType.length > 64) {
    return res.status(400).json({ success: false, message: "Vehicle type is too long." });
  }

  if (vehicleRegistration && vehicleRegistration.length > 128) {
    return res.status(400).json({ success: false, message: "Vehicle registration is too long." });
  }

  if (licenseLast4 && !/^\d{4}$/.test(licenseLast4)) {
    return res.status(400).json({ success: false, message: "License last 4 digits must be exactly 4 numbers." });
  }

  try {
    const existingRider = await getRiderByUserId(userId);
    if (existingRider) {
      return res.status(409).json({
        success: false,
        message: "A rider application already exists for this user.",
        data: null
      });
    }

    const insertResult = await db.query(
      `INSERT INTO riders (user_id, verification_status, vehicle_type, vehicle_registration, license_number_last4)
       VALUES ($1, 'PENDING', $2, $3, $4)
       RETURNING *`,
      [userId, vehicleType || null, vehicleRegistration || null, licenseLast4 || null]
    );

    return res.status(201).json({
      success: true,
      message: "Rider application submitted.",
      data: safeRiderRow(insertResult.rows[0])
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ success: false, message: "A rider application already exists for this user.", data: null });
    }
    console.error("Rider application creation failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to create rider application.", data: null });
  }
}

async function getRiderProfile(req, res) {
  try {
    const rider = await getRiderByUserId(req.user.id);
    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider profile not found.", data: null });
    }
    return res.json({
      success: true,
      data: {
        rider: safeRiderRow(rider),
        user: await getRiderUserProfile(req.user.id)
      }
    });
  } catch (error) {
    console.error("Rider profile retrieval failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve rider profile.", data: null });
  }
}

async function updateRiderProfile(req, res) {
  const body = req.body || {};
  const disallowedFields = ["user_id", "verification_status", "approved_by_user_id", "approved_at", "deleted_at", "is_available"];

  for (const field of disallowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      return res.status(400).json({ success: false, message: `Field "${field}" cannot be changed through the rider profile API.`, data: null });
    }
  }

  const vehicleType = Object.prototype.hasOwnProperty.call(body, "vehicle_type") ? valueText(body.vehicle_type) : undefined;
  const vehicleRegistration = Object.prototype.hasOwnProperty.call(body, "vehicle_registration") || Object.prototype.hasOwnProperty.call(body, "vehicle_number")
    ? valueText(body.vehicle_registration ?? body.vehicle_number)
    : undefined;
  const licenseNumberLast4 = Object.prototype.hasOwnProperty.call(body, "license_number_last4") || Object.prototype.hasOwnProperty.call(body, "license_last4")
    ? valueText(body.license_number_last4 ?? body.license_last4)
    : undefined;

  if (vehicleType !== undefined && vehicleType !== "" && vehicleType.length > 64) {
    return res.status(400).json({ success: false, message: "Vehicle type is too long." });
  }
  if (vehicleRegistration !== undefined && vehicleRegistration !== "" && vehicleRegistration.length > 128) {
    return res.status(400).json({ success: false, message: "Vehicle registration is too long." });
  }
  if (licenseNumberLast4 !== undefined && licenseNumberLast4 !== "" && !/^\d{4}$/.test(licenseNumberLast4)) {
    return res.status(400).json({ success: false, message: "License last 4 digits must be exactly 4 numbers." });
  }

  try {
    const rider = await getRiderByUserId(req.user.id);
    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider profile not found.", data: null });
    }

    const updates = [];
    const values = [];
    let index = 1;

    if (Object.prototype.hasOwnProperty.call(body, "vehicle_type")) {
      updates.push(`vehicle_type = $${index++}`);
      values.push(vehicleType || null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "vehicle_registration") || Object.prototype.hasOwnProperty.call(body, "vehicle_number")) {
      updates.push(`vehicle_registration = $${index++}`);
      values.push(vehicleRegistration || null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "license_number_last4") || Object.prototype.hasOwnProperty.call(body, "license_last4")) {
      updates.push(`license_number_last4 = $${index++}`);
      values.push(licenseNumberLast4 || null);
    }

    if (!updates.length) {
      return res.json({ success: true, message: "No profile changes were made.", data: { rider: safeRiderRow(rider) } });
    }

    updates.push(`updated_at = now()`);
    values.push(rider.id);

    const result = await db.query(
      `UPDATE riders
       SET ${updates.join(", ")}
       WHERE id = $${index}
       RETURNING *`,
      values
    );

    return res.json({
      success: true,
      message: "Rider profile updated.",
      data: {
        rider: safeRiderRow(result.rows[0]),
        user: await getRiderUserProfile(req.user.id)
      }
    });
  } catch (error) {
    console.error("Rider profile update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update rider profile.", data: null });
  }
}

async function listRiderDocuments(req, res) {
  try {
    const rider = await getRiderByUserId(req.user.id);
    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider profile not found.", data: [] });
    }

    const result = await db.query(
      `SELECT *
       FROM rider_documents
       WHERE rider_id = $1
       ORDER BY created_at DESC`,
      [rider.id]
    );

    return res.json({
      success: true,
      data: result.rows.map(safeDocumentRow)
    });
  } catch (error) {
    console.error("Rider document lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve rider documents.", data: [] });
  }
}

async function createRiderDocument(req, res) {
  try {
    const rider = await getRiderByUserId(req.user.id);
    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider profile not found.", data: null });
    }

    const body = req.body || {};
    const documentType = normalizeDocumentType(body.document_type || body.type);
    const objectKey = valueText(body.object_key || body.objectKey || body.key);
    const originalFilename = valueText(body.original_filename || body.originalFileName || body.filename);
    const contentType = valueText(body.content_type || body.contentType || "");
    const requestedStatus = normalizeStatus(body.verification_status || body.status, "PENDING");

    if (!documentType) {
      return res.status(400).json({ success: false, message: "Unsupported document type." });
    }
    if (!objectKey) {
      return res.status(400).json({ success: false, message: "Document object key is required." });
    }
    if (Object.prototype.hasOwnProperty.call(body, "reviewed_by_user_id") || Object.prototype.hasOwnProperty.call(body, "reviewed_at")) {
      return res.status(400).json({ success: false, message: "Review fields cannot be set by the rider." });
    }
    if (requestedStatus !== "PENDING") {
      return res.status(400).json({ success: false, message: "Riders cannot set document verification status to anything other than PENDING." });
    }
    if (!VALID_RIDER_STATUSES.has(requestedStatus)) {
      return res.status(400).json({ success: false, message: "Unsupported document verification status." });
    }

    const result = await db.query(
      `INSERT INTO rider_documents (rider_id, document_type, object_key, original_filename, content_type, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [rider.id, documentType, objectKey, originalFilename || null, contentType || null, requestedStatus]
    );

    return res.status(201).json({
      success: true,
      message: "Document metadata saved.",
      data: safeDocumentRow(result.rows[0])
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ success: false, message: "This document metadata already exists for this rider.", data: null });
    }
    console.error("Rider document creation failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to save rider document metadata.", data: null });
  }
}

async function getRiderAvailability(req, res) {
  try {
    const rider = await getRiderByUserId(req.user.id);
    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider profile not found.", data: null });
    }

    const result = await db.query(
      `SELECT id, rider_id, is_available, started_at, ended_at, source
       FROM rider_availability
       WHERE rider_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [rider.id]
    );

    const openInterval = result.rows[0] || null;
    return res.json({
      success: true,
      data: {
        rider_id: rider.id,
        is_available: Boolean(rider.is_available),
        open_interval: openInterval ? {
          id: openInterval.id,
          is_available: Boolean(openInterval.is_available),
          started_at: openInterval.started_at,
          ended_at: openInterval.ended_at,
          source: openInterval.source
        } : null
      }
    });
  } catch (error) {
    console.error("Rider availability lookup failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve rider availability.", data: null });
  }
}

async function setRiderAvailability(req, res) {
  const desiredAvailable = req.body && typeof req.body.is_available === "boolean" ? req.body.is_available : (
    typeof req.body?.is_available === "string" ? req.body.is_available === "true" : null
  );

  if (desiredAvailable === null) {
    return res.status(400).json({ success: false, message: "A valid is_available boolean is required." });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const rider = await getRiderByUserId(req.user.id, client);
    if (!rider) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Rider profile not found.", data: null });
    }

    if (rider.verification_status !== "APPROVED") {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "Rider availability is approved-only. Only approved riders may go online.",
        data: null
      });
    }

    if (Boolean(rider.is_available) === desiredAvailable) {
      await client.query("COMMIT");
      return res.json({
        success: true,
        message: desiredAvailable ? "Rider is already online." : "Rider is already offline.",
        data: {
          rider_id: rider.id,
          is_available: Boolean(rider.is_available)
        }
      });
    }

    if (desiredAvailable) {
      const insertResult = await client.query(
        `INSERT INTO rider_availability (rider_id, is_available, source)
         VALUES ($1, true, 'RIDER_APP')
         RETURNING *`,
        [rider.id]
      );
      const updatedRider = await client.query(
        `UPDATE riders
         SET is_available = true, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [rider.id]
      );
      await client.query("COMMIT");
      return res.json({
        success: true,
        message: "Rider is now online.",
        data: {
          rider_id: updatedRider.rows[0].id,
          is_available: true,
          availability_id: insertResult.rows[0].id
        }
      });
    }

    await client.query(
      `UPDATE rider_availability
       SET ended_at = now()
       WHERE rider_id = $1 AND ended_at IS NULL`,
      [rider.id]
    );
    const updatedRider = await client.query(
      `UPDATE riders
       SET is_available = false, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [rider.id]
    );
    await client.query("COMMIT");
    return res.json({
      success: true,
      message: "Rider is now offline.",
      data: {
        rider_id: updatedRider.rows[0].id,
        is_available: false
      }
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
    if (error.code === "23505") {
      return res.status(409).json({ success: false, message: "An open rider availability interval already exists.", data: null });
    }
    console.error("Rider availability update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update rider availability.", data: null });
  } finally {
    client.release();
  }
}

async function getRiderDashboard(req, res) {
  try {
    const rider = await getRiderByUserId(req.user.id);
    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider profile not found.", data: null });
    }
    const user = await getRiderUserProfile(req.user.id);
    if (!user) {
      return res.status(401).json({ success: false, message: "Authentication required.", data: null });
    }

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          display_name: user.display_name,
          email: user.email,
          phone_e164: user.phone_e164
        },
        rider: {
          id: rider.id,
          verification_status: rider.verification_status,
          is_available: Boolean(rider.is_available),
          vehicle_type: rider.vehicle_type || null,
          vehicle_registration: rider.vehicle_registration || null,
          license_number_last4: rider.license_number_last4 || null,
          approved_at: rider.approved_at || null
        }
      }
    });
  } catch (error) {
    console.error("Rider dashboard retrieval failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve rider dashboard.", data: null });
  }
}

module.exports = {
  createRiderApplication,
  getRiderProfile,
  updateRiderProfile,
  listRiderDocuments,
  createRiderDocument,
  getRiderAvailability,
  setRiderAvailability,
  getRiderDashboard,
  safeRiderRow,
  safeDocumentRow
};
