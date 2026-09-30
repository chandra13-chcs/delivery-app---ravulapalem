"use strict";

const db = require("../config/db");
const { normalizeOptionalCoordinates } = require("../utils/location");
const { evaluateDeliveryServiceability } = require("../services/serviceabilityService");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respondError(res, status, message) {
  return res.status(status).json({ success: false, message, data: null });
}

async function checkCustomerServiceability(req, res) {
  const addressId = req.body?.address_id == null ? null : String(req.body.address_id).trim();
  if (addressId && !UUID_PATTERN.test(addressId)) return respondError(res, 400, "Invalid address id.");

  try {
    let coordinates;
    let postalCode;
    if (addressId) {
      const addressResult = await db.query(
        `SELECT latitude, longitude, postal_code
         FROM user_addresses
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [addressId, req.user.id]
      );
      const address = addressResult.rows[0];
      if (!address) return respondError(res, 404, "Address not found.");
      coordinates = normalizeOptionalCoordinates(address.latitude, address.longitude);
      postalCode = address.postal_code;
    } else {
      coordinates = normalizeOptionalCoordinates(req.body?.latitude, req.body?.longitude);
      postalCode = req.body?.postal_code;
      const hasCompleteCoordinates = coordinates.latitude !== null && coordinates.longitude !== null;
      const hasPostalCode = postalCode != null && String(postalCode).trim() !== "";
      if (!hasCompleteCoordinates && !hasPostalCode) {
        return respondError(res, 400, "A postal code or complete coordinate pair is required.");
      }
    }

    const result = await evaluateDeliveryServiceability({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      postal_code: postalCode,
      shop_id: req.body?.shop_id
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    if (error.status) return respondError(res, error.status, error.message);
    console.error("Customer serviceability check failed:", error.message);
    return respondError(res, 500, "Unable to check delivery serviceability.");
  }
}

module.exports = { checkCustomerServiceability };
