"use strict";

const db = require("../config/db");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS_FIELDS = `id, label, recipient_name, recipient_phone_e164, address_line1,
  address_line2, landmark, locality, city, state, postal_code, country_code,
  latitude, longitude, is_default, created_at, updated_at`;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (/^\+[1-9][0-9]{7,14}$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return null;
}

function hasAny(input, keys) {
  return keys.some(key => Object.prototype.hasOwnProperty.call(input, key));
}

function getInput(input, keys, fallback) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  }
  return fallback;
}

function normalizeAddress(input, existing = null, accountPhone = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpError(400, "A valid address object is required.");
  }

  const recipientName = String(getInput(input, ["recipient_name", "fullName"], existing?.recipient_name || "") || "").trim();
  const phoneWasSupplied = hasAny(input, ["recipient_phone_e164", "mobile"]);
  const rawPhone = getInput(input, ["recipient_phone_e164", "mobile"], existing?.recipient_phone_e164 || accountPhone);
  const phone = normalizePhone(rawPhone);
  const legacyAddressLine = [input.house, input.street].filter(Boolean).join(", ");
  const addressLine1 = String(getInput(input, ["address_line1"], legacyAddressLine || existing?.address_line1 || "") || "").trim();
  const addressLine2Value = getInput(input, ["address_line2"], input.street ?? existing?.address_line2 ?? null);
  const addressLine2 = addressLine2Value == null ? null : String(addressLine2Value).trim() || null;
  const landmarkValue = getInput(input, ["landmark"], existing?.landmark ?? null);
  const localityValue = getInput(input, ["locality", "district"], existing?.locality ?? null);
  const city = String(getInput(input, ["city"], existing?.city || "") || "").trim();
  const state = String(getInput(input, ["state"], existing?.state || "") || "").trim();
  const postalCode = String(getInput(input, ["postal_code", "pincode"], existing?.postal_code || "") || "").trim();
  const countryCode = String(getInput(input, ["country_code"], existing?.country_code || "IN") || "IN").trim().toUpperCase();
  const latitudeValue = getInput(input, ["latitude"], existing?.latitude ?? null);
  const longitudeValue = getInput(input, ["longitude"], existing?.longitude ?? null);
  const latitude = latitudeValue == null || latitudeValue === "" ? null : Number(latitudeValue);
  const longitude = longitudeValue == null || longitudeValue === "" ? null : Number(longitudeValue);
  const label = String(getInput(input, ["label"], existing?.label || "Home") || "Home").trim();
  const defaultValue = getInput(input, ["is_default"], existing?.is_default ?? false);

  if (!recipientName || recipientName.length > 200 || !phone || (phoneWasSupplied && !String(rawPhone || "").trim())
      || !addressLine1 || addressLine1.length > 1000 || (addressLine2 && addressLine2.length > 1000)
      || (landmarkValue != null && String(landmarkValue).length > 500)
      || (localityValue != null && String(localityValue).length > 200)
      || !city || city.length > 200 || !state || state.length > 200
      || !postalCode || postalCode.length > 16 || !/^[A-Z]{2}$/.test(countryCode)
      || !label || label.length > 80
      || (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
      || (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
      || ((latitude === null) !== (longitude === null))
      || typeof defaultValue !== "boolean") {
    throw httpError(400, "The address is incomplete or invalid.");
  }

  return {
    label,
    recipient_name: recipientName,
    recipient_phone_e164: phone,
    address_line1: addressLine1,
    address_line2: addressLine2,
    landmark: landmarkValue == null ? null : String(landmarkValue).trim() || null,
    locality: localityValue == null ? null : String(localityValue).trim() || null,
    city,
    state,
    postal_code: postalCode,
    country_code: countryCode,
    latitude,
    longitude,
    is_default: defaultValue
  };
}

async function lockCustomer(client, userId) {
  const result = await client.query(
    `SELECT id, phone_e164
     FROM users
     WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
     FOR UPDATE`,
    [userId]
  );
  if (!result.rows[0]) throw httpError(401, "Authentication required.");
  return result.rows[0];
}

async function rollback(client) {
  if (client) await client.query("ROLLBACK").catch(() => {});
}

function respondError(res, error, action) {
  if (error.status) return res.status(error.status).json({ success: false, message: error.message });
  if (error.code === "23505") {
    return res.status(409).json({ success: false, message: "Unable to apply the address change. Please retry." });
  }
  console.error(`${action} failed:`, error.message);
  return res.status(500).json({ success: false, message: "Unable to process addresses." });
}

function validateAddressId(id) {
  return UUID_PATTERN.test(String(id || ""));
}

async function listCustomerAddresses(req, res) {
  try {
    const result = await db.query(
      `SELECT ${ADDRESS_FIELDS}
       FROM user_addresses
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY is_default DESC, created_at ASC, id ASC`,
      [req.user.id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return respondError(res, error, "Customer address listing");
  }
}

async function createCustomerAddress(req, res) {
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const customer = await lockCustomer(client, req.user.id);
    const address = normalizeAddress(req.body, null, customer.phone_e164);
    const currentDefault = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM user_addresses WHERE user_id = $1 AND deleted_at IS NULL AND is_default = true
       ) AS has_default`,
      [req.user.id]
    );
    const makeDefault = address.is_default || !currentDefault.rows[0]?.has_default;
    if (makeDefault) {
      await client.query(
        `UPDATE user_addresses SET is_default = false
         WHERE user_id = $1 AND deleted_at IS NULL AND is_default = true`,
        [req.user.id]
      );
    }
    const result = await client.query(
      `INSERT INTO user_addresses
         (user_id, label, recipient_name, recipient_phone_e164, address_line1, address_line2,
          landmark, locality, city, state, postal_code, country_code, latitude, longitude, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING ${ADDRESS_FIELDS}`,
      [req.user.id, address.label, address.recipient_name, address.recipient_phone_e164,
        address.address_line1, address.address_line2, address.landmark, address.locality,
        address.city, address.state, address.postal_code, address.country_code,
        address.latitude, address.longitude, makeDefault]
    );
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    await rollback(client);
    return respondError(res, error, "Customer address creation");
  } finally {
    client?.release();
  }
}

async function updateCustomerAddress(req, res) {
  const addressId = req.params.id;
  if (!validateAddressId(addressId)) return res.status(400).json({ success: false, message: "Invalid address id." });

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const customer = await lockCustomer(client, req.user.id);
    const existingResult = await client.query(
      `SELECT ${ADDRESS_FIELDS} FROM user_addresses
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [addressId, req.user.id]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Address not found." });
    }
    const address = normalizeAddress(req.body, existing, customer.phone_e164);
    if (address.is_default) {
      await client.query(
        `UPDATE user_addresses SET is_default = false
         WHERE user_id = $1 AND deleted_at IS NULL AND is_default = true AND id <> $2`,
        [req.user.id, addressId]
      );
    }
    const result = await client.query(
      `UPDATE user_addresses
       SET label = $3, recipient_name = $4, recipient_phone_e164 = $5, address_line1 = $6,
           address_line2 = $7, landmark = $8, locality = $9, city = $10, state = $11,
           postal_code = $12, country_code = $13, latitude = $14, longitude = $15,
           is_default = $16, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING ${ADDRESS_FIELDS}`,
      [addressId, req.user.id, address.label, address.recipient_name,
        address.recipient_phone_e164, address.address_line1, address.address_line2,
        address.landmark, address.locality, address.city, address.state,
        address.postal_code, address.country_code, address.latitude,
        address.longitude, address.is_default]
    );
    await client.query("COMMIT");
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    await rollback(client);
    return respondError(res, error, "Customer address update");
  } finally {
    client?.release();
  }
}

async function setDefaultCustomerAddress(req, res) {
  const addressId = req.params.id;
  if (!validateAddressId(addressId)) return res.status(400).json({ success: false, message: "Invalid address id." });

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    await lockCustomer(client, req.user.id);
    const existing = await client.query(
      `SELECT id FROM user_addresses
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [addressId, req.user.id]
    );
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Address not found." });
    }
    await client.query(
      `UPDATE user_addresses SET is_default = false
       WHERE user_id = $1 AND deleted_at IS NULL AND is_default = true AND id <> $2`,
      [req.user.id, addressId]
    );
    const result = await client.query(
      `UPDATE user_addresses SET is_default = true, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING ${ADDRESS_FIELDS}`,
      [addressId, req.user.id]
    );
    await client.query("COMMIT");
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    await rollback(client);
    return respondError(res, error, "Customer default address update");
  } finally {
    client?.release();
  }
}

async function deleteCustomerAddress(req, res) {
  const addressId = req.params.id;
  if (!validateAddressId(addressId)) return res.status(400).json({ success: false, message: "Invalid address id." });

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    await lockCustomer(client, req.user.id);
    const result = await client.query(
      `UPDATE user_addresses
       SET is_default = false, deleted_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [addressId, req.user.id]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Address not found." });
    }
    await client.query("COMMIT");
    return res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    await rollback(client);
    return respondError(res, error, "Customer address deletion");
  } finally {
    client?.release();
  }
}

module.exports = {
  listCustomerAddresses,
  createCustomerAddress,
  updateCustomerAddress,
  setDefaultCustomerAddress,
  deleteCustomerAddress,
  validateAddressId
};