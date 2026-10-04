"use strict";

const crypto = require("crypto");
const db = require("../config/db");
const objectStorageService = require("../services/objectStorageService");

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
const UPLOAD_DOCUMENT_TYPES = new Set(["SELFIE", "AADHAAR", "PAN", "PROFILE_PHOTO"]);
const UPLOAD_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UPLOAD_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
  const file = req.file || null;
  const mimeType = String(file?.mimetype || "").toLowerCase();
  const originalName = typeof file?.originalname === "string" ? file.originalname : "profile-photo";
  const extension = (originalName.split(".").pop() || "").toLowerCase();

  const vehicleType = valueText(body.vehicle_type || body.vehicleType);
  const vehicleRegistration = valueText(body.vehicle_registration || body.vehicle_number || body.vehicleRegistration);
  const licenseLast4 = valueText(body.license_last4 || body.license_number_last4 || body.licenseLast4);

  if (!file || !UPLOAD_MIME_TYPES.has(mimeType) || !UPLOAD_EXTENSIONS.has(extension)) {
    return res.status(400).json({
      success: false,
      code: "PROFILE_PHOTO_REQUIRED",
      message: "A JPG, PNG, or WEBP profile photo is required."
    });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return res.status(400).json({ success: false, message: "Profile photo must be 10 MB or smaller." });
  }
  if (vehicleType && vehicleType.length > 64) {
    return res.status(400).json({ success: false, message: "Vehicle type is too long." });
  }

  if (vehicleRegistration && vehicleRegistration.length > 128) {
    return res.status(400).json({ success: false, message: "Vehicle registration is too long." });
  }

  if (licenseLast4 && !/^\d{4}$/.test(licenseLast4)) {
    return res.status(400).json({ success: false, message: "License last 4 digits must be exactly 4 numbers." });
  }

  let client;
  let uploadedObjectKey = "";
  try {
    const existingRider = await getRiderByUserId(userId);
    if (existingRider) {
      return res.status(409).json({
        success: false,
        message: "A rider application already exists for this user.",
        data: null
      });
    }

    if (!objectStorageService.isObjectStorageConfigured()) {
      return res.status(503).json({
        success: false,
        code: "OBJECT_STORAGE_NOT_CONFIGURED",
        message: "Secure profile photo storage is not configured yet."
      });
    }

    const riderId = crypto.randomUUID();
    uploadedObjectKey = `riders/${riderId}/documents/PROFILE_PHOTO/${crypto.randomUUID()}.${extension}`;
    const uploadResult = await objectStorageService.uploadFile({
      key: uploadedObjectKey,
      fileBuffer: file.buffer,
      contentType: mimeType,
      metadata: {
        rider_id: riderId,
        document_type: "PROFILE_PHOTO",
        original_filename: originalName
      }
    });
    if (!uploadResult?.success) {
      return res.status(503).json({
        success: false,
        code: uploadResult?.code || "OBJECT_STORAGE_UNAVAILABLE",
        message: uploadResult?.message || "Secure profile photo storage is unavailable."
      });
    }

    client = await db.connect();
    await client.query("BEGIN");
    const insertResult = await client.query(
      `INSERT INTO riders (user_id, verification_status, vehicle_type, vehicle_registration, license_number_last4)
       VALUES ($1, 'PENDING', $2, $3, $4)
       RETURNING *`,
      [userId, vehicleType || null, vehicleRegistration || null, licenseLast4 || null]
    );
    const rider = insertResult.rows[0];
    await client.query(
      `INSERT INTO rider_documents (rider_id, document_type, object_key, original_filename, content_type, verification_status)
       VALUES ($1, 'PROFILE_PHOTO', $2, $3, $4, 'PENDING')`,
      [rider.id, uploadedObjectKey, originalName || null, mimeType]
    );
    await client.query("COMMIT");
    return res.status(201).json({
      success: true,
      message: "Rider application submitted.",
      data: safeRiderRow(rider)
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (uploadedObjectKey) {
      const cleanupResult = await objectStorageService.deleteFile(uploadedObjectKey);
      if (!cleanupResult?.success) {
        console.warn("Unable to remove failed rider profile photo upload:", cleanupResult?.message || "Storage deletion failed.");
      }
    }
    if (error.code === "23505") {
      return res.status(409).json({ success: false, message: "A rider application already exists for this user.", data: null });
    }
    console.error("Rider application creation failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to create rider application.", data: null });
  } finally {
    client?.release();
  }
}

async function getRiderProfile(req, res) {
  try {
    const rider = await getRiderByUserId(req.user.id);
    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider profile not found.", data: null });
    }
    const photoResult = await db.query(
      `SELECT object_key
       FROM rider_documents
       WHERE rider_id = $1 AND document_type = 'PROFILE_PHOTO'
       ORDER BY created_at DESC
       LIMIT 1`,
      [rider.id]
    );
    const profilePhotoUrl = photoResult.rows[0]?.object_key
      ? await objectStorageService.getSignedFileUrl(photoResult.rows[0].object_key, { expiresIn: 3600 })
      : null;
    return res.json({
      success: true,
      data: {
        rider: { ...safeRiderRow(rider), profile_photo_url: profilePhotoUrl },
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

async function uploadRiderDocument(req, res) {
  const body = req.body || {};
  const file = req.file || null;
  const rawDocumentType = body.document_type || body.documentType || body.type || "";
  const documentType = normalizeDocumentType(rawDocumentType);

  if (!file) {
    return res.status(400).json({
      success: false,
      code: "UPLOAD_VALIDATION_ERROR",
      message: "A document file is required."
    });
  }

  if (!documentType || !UPLOAD_DOCUMENT_TYPES.has(documentType)) {
    return res.status(400).json({
      success: false,
      code: "UPLOAD_VALIDATION_ERROR",
      message: "Unsupported document type. Use SELFIE, AADHAAR, PAN, or PROFILE_PHOTO."
    });
  }

  const mimeType = String(file.mimetype || "").toLowerCase();
  const originalName = typeof file.originalname === "string" ? file.originalname : "document";
  const extension = (originalName.split(".").pop() || "").toLowerCase();

  if (!UPLOAD_MIME_TYPES.has(mimeType) || !UPLOAD_EXTENSIONS.has(extension)) {
    return res.status(400).json({
      success: false,
      code: "UPLOAD_VALIDATION_ERROR",
      message: "Unsupported file type. Only JPG, PNG, and WEBP images are allowed."
    });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return res.status(400).json({
      success: false,
      code: "UPLOAD_VALIDATION_ERROR",
      message: "File must be 10 MB or smaller."
    });
  }

  try {
    const rider = await getRiderByUserId(req.user.id);
    if (!rider) {
      return res.status(403).json({
        success: false,
        code: "RIDER_ACCESS_REQUIRED",
        message: "Rider access is required to upload verification documents."
      });
    }

    if (!objectStorageService.isObjectStorageConfigured()) {
      return res.status(503).json({
        success: false,
        code: "OBJECT_STORAGE_NOT_CONFIGURED",
        message: "Secure document storage is not configured yet."
      });
    }

    const objectKey = `riders/${rider.id}/documents/${documentType}/${crypto.randomUUID()}.${extension}`;

    const uploadResult = await objectStorageService.uploadFile({
      key: objectKey,
      fileBuffer: file.buffer,
      contentType: mimeType,
      metadata: {
        rider_id: rider.id,
        document_type: documentType,
        original_filename: originalName
      }
    });

    if (!uploadResult?.success) {
      return res.status(503).json({
        success: false,
        code: uploadResult?.code || "OBJECT_STORAGE_UNAVAILABLE",
        message: uploadResult?.message || "Secure document storage is unavailable."
      });
    }

    try {
      const result = await db.query(
        `INSERT INTO rider_documents (rider_id, document_type, object_key, original_filename, content_type, verification_status)
         VALUES ($1, $2, $3, $4, $5, 'PENDING')
         RETURNING *`,
        [rider.id, documentType, objectKey, originalName || null, mimeType || null]
      );

      if (documentType === "PROFILE_PHOTO") {
        try {
          const previousPhotos = await db.query(
            `DELETE FROM rider_documents
             WHERE rider_id = $1 AND document_type = 'PROFILE_PHOTO' AND id <> $2
             RETURNING object_key`,
            [rider.id, result.rows[0].id]
          );
          for (const previousPhoto of previousPhotos.rows) {
            const deleteResult = await objectStorageService.deleteFile(previousPhoto.object_key);
            if (!deleteResult?.success) {
              console.warn("Unable to remove replaced rider profile photo:", deleteResult?.message || "Storage deletion failed.");
            }
          }
        } catch (cleanupError) {
          console.warn("Unable to clean up replaced rider profile photo metadata:", cleanupError.message);
        }
      }

      return res.status(201).json({
        success: true,
        message: "Document uploaded securely.",
        data: safeDocumentRow(result.rows[0])
      });
    } catch (dbError) {
      console.error("Rider document metadata save failed after upload:", dbError.message);
      await objectStorageService.deleteFile(objectKey).catch(() => {});
      if (dbError.code === "23505") {
        return res.status(409).json({
          success: false,
          code: "DOCUMENT_ALREADY_EXISTS",
          message: "This document record already exists for this rider."
        });
      }
      return res.status(500).json({
        success: false,
        code: "DOCUMENT_SAVE_FAILED",
        message: "Document upload succeeded, but saving the record failed."
      });
    }
  } catch (error) {
    console.error("Rider document upload failed:", error.message);
    return res.status(500).json({
      success: false,
      code: "UPLOAD_FAILED",
      message: "Unable to process the rider document upload."
    });
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
  uploadRiderDocument,
  getRiderAvailability,
  setRiderAvailability,
  getRiderDashboard,
  safeRiderRow,
  safeDocumentRow
};
