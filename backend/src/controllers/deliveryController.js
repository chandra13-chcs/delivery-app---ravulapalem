"use strict";

const crypto = require("crypto");
const db = require("../config/db");
const {
  generateOtp,
  hashOtp,
  matchesOtp,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_REQUEST_WINDOW_MS,
  OTP_MAX_REQUESTS_PER_WINDOW,
  sendOtp
} = require("../services/otpService");
const { ORDER_PROJECTION, ACTIVE_STATUSES, PAST_STATUSES, presentOrder } = require("./orderController");
const { loadRiderEarningConfig, calculateRiderEarningSnapshot } = require("../services/riderEarningsService");
const { calculateEta, calculateCustomerOrderEta, unavailableEta, loadEtaConfig } = require("../services/etaService");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_ASSIGNMENT_STATUSES = ["OFFERED", "ACCEPTED", "PICKING_UP", "OUT_FOR_DELIVERY"];
const RIDER_ORDER_PROJECTION = `
  SELECT da.id AS assignment_id, da.status AS assignment_status, da.assigned_at,
         da.accepted_at, da.rejection_reason, o.id, o.order_number, o.status,
         o.order_type, o.total_amount, o.delivery_fee, o.rider_tip, o.currency,
         COALESCE(payment.method, 'COD') AS payment_mode,
         payment.status AS payment_status,
         parcel.parcel_pickup_address,
         parcel.parcel_drop_address, parcel.parcel_description,
         CASE WHEN o.status = 'OUT_FOR_DELIVERY' THEN oa.recipient_name END AS recipient_name,
         CASE WHEN o.status = 'OUT_FOR_DELIVERY' THEN oa.recipient_phone_e164 END AS customer_phone,
         CASE WHEN o.status = 'OUT_FOR_DELIVERY' THEN concat_ws(', ', oa.address_line1, oa.address_line2, oa.landmark, oa.locality, oa.city, oa.state, oa.postal_code) END AS delivery_address,
         CASE WHEN o.status = 'OUT_FOR_DELIVERY' THEN oa.latitude END AS delivery_latitude,
         CASE WHEN o.status = 'OUT_FOR_DELIVERY' THEN oa.longitude END AS delivery_longitude,
         COALESCE(item_data.items, '[]'::jsonb) AS items,
         COALESCE(fulfillment_data.items, '[]'::jsonb) AS fulfillments
  FROM delivery_assignments da
  JOIN orders o ON o.id = da.order_id
  LEFT JOIN order_addresses oa ON oa.order_id = o.id
  LEFT JOIN LATERAL (
    SELECT p.method, p.status FROM payments p WHERE p.order_id = o.id
    ORDER BY p.created_at DESC LIMIT 1
  ) payment ON true
  LEFT JOIN parcel_details parcel ON parcel.order_id = o.id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', oi.id, 'name', oi.product_name_snapshot, 'quantity', oi.quantity,
      'unit', oi.unit_snapshot, 'fulfillment_id', oi.fulfillment_id,
      'pickup_source_name', f.shop_name_snapshot,
      'pickup_source_address', f.pickup_address_snapshot
    ) ORDER BY oi.created_at, oi.id) AS items
    FROM order_items oi
    LEFT JOIN order_fulfillments f ON f.id = oi.fulfillment_id
    WHERE oi.order_id = o.id
  ) item_data ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'shop_id', f.shop_id, 'shop_name', f.shop_name_snapshot,
      'pickup_address', f.pickup_address_snapshot, 'status', f.status,
      'arrived', EXISTS (
        SELECT 1 FROM delivery_tracking dt
        WHERE dt.assignment_id = da.id AND dt.event_type = 'ARRIVED_AT_PICKUP'
          AND dt.details->>'fulfillment_id' = f.id::text
      ),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', oi.id, 'name', oi.product_name_snapshot, 'quantity', oi.quantity,
          'unit', oi.unit_snapshot, 'fulfillment_id', oi.fulfillment_id,
          'pickup_source_name', f.shop_name_snapshot,
          'pickup_source_address', f.pickup_address_snapshot
        ) ORDER BY oi.created_at, oi.id)
        FROM order_items oi WHERE oi.fulfillment_id = f.id
      ), '[]'::jsonb)
    ) ORDER BY f.created_at, f.id) AS items
    FROM order_fulfillments f
    WHERE f.order_id = o.id
  ) fulfillment_data ON true`;

function respondError(res, status, message) {
  return res.status(status).json({ success: false, message, data: null });
}

function validateUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function getDeliveryCodeSecret() {
  const secret = process.env.OTP_HMAC_SECRET || process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET;
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Delivery code verification is unavailable.");
  }
  return secret;
}

function hashDeliveryCode(orderId, code) {
  return crypto.createHmac("sha256", getDeliveryCodeSecret())
    .update(`myshopzy-delivery-code-v1\0${orderId}\0${code}`, "utf8")
    .digest();
}

function matchesDeliveryCode(storedDigest, orderId, code) {
  const actual = Buffer.isBuffer(storedDigest) ? storedDigest : Buffer.from(storedDigest || []);
  const expected = hashDeliveryCode(orderId, code);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function resolveApprovedRider(userId, queryable = db) {
  const result = await queryable.query(
    `SELECT r.id, r.verification_status, r.is_available, u.display_name, u.phone_e164
     FROM riders r
     JOIN users u ON u.id = r.user_id
     WHERE r.user_id = $1 AND r.deleted_at IS NULL
       AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       AND r.verification_status = 'APPROVED'`,
    [userId]
  );
  return result.rows[0] || null;
}

async function getRiderActiveAssignments(client, riderId, excludeAssignmentId = null) {
  const result = await client.query(
    `SELECT da.id, da.status, da.order_id
     FROM delivery_assignments da
     WHERE da.rider_id = $1
       AND da.status = ANY($2::text[])
       AND ($3::uuid IS NULL OR da.id <> $3)
     ORDER BY da.assigned_at DESC
     FOR UPDATE OF da`,
    [riderId, ACTIVE_ASSIGNMENT_STATUSES, excludeAssignmentId || null]
  );
  return result.rows;
}

async function hasCurrentRiderAvailability(riderId, queryable = db) {
  const result = await queryable.query(
    `SELECT EXISTS (
       SELECT 1 FROM riders r
       JOIN rider_availability availability ON availability.rider_id = r.id
       WHERE r.id = $1 AND r.is_available = true
         AND availability.is_available = true AND availability.ended_at IS NULL
     ) AS is_available`,
    [riderId]
  );
  return Boolean(result.rows[0]?.is_available);
}

function insertNotification(queryable, userId, title, body, payload) {
  return queryable.query(
    `INSERT INTO notifications (user_id, channel, status, title, body, payload)
     VALUES ($1, 'IN_APP', 'PENDING', $2, $3, $4::jsonb)`,
    [userId, title, body, JSON.stringify(payload)]
  );
}

async function deliveryOtpRequestCount(queryable, destination, purpose) {
  const result = await queryable.query(
    `SELECT count(*)::int AS request_count
     FROM otp_verifications
     WHERE destination = $1 AND purpose = $2
       AND created_at > now() - ($3::int * interval '1 millisecond')`,
    [destination, purpose, OTP_REQUEST_WINDOW_MS]
  );
  return result.rows[0]?.request_count || 0;
}

async function listEligibleRiders(req, res) {
  const orderId = req.query.order_id;
  if (orderId && !validateUuid(orderId)) return respondError(res, 400, "Invalid order id.");
  try {
    const result = await db.query(
      `SELECT r.id, u.display_name AS name, r.vehicle_type, r.is_available
       FROM riders r JOIN users u ON u.id = r.user_id
       WHERE r.deleted_at IS NULL AND r.verification_status = 'APPROVED'
         AND r.is_available = true AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM rider_availability availability
           WHERE availability.rider_id = r.id
             AND availability.is_available = true AND availability.ended_at IS NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM delivery_assignments active
           WHERE active.rider_id = r.id
             AND active.status IN ('OFFERED', 'ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY')
         )
       ORDER BY u.display_name, r.id`
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Eligible rider lookup failed:", error.message);
    return respondError(res, 500, "Unable to retrieve eligible riders.");
  }
}

function presentAdminDeliveryOrder(row, assignment) {
  const order = presentOrder(row);
  return {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    order_type: order.order_type,
    total_amount: order.total_amount,
    payment_mode: order.payment_mode,
    delivery_address: order.delivery_address,
    delivery_latitude: order.delivery_latitude,
    delivery_longitude: order.delivery_longitude,
    customer_name: row.recipient_name || row.customer_name,
    customer_phone: row.recipient_phone_e164 || row.customer_phone,
    parcel_pickup_address: order.parcel_pickup_address,
    parcel_drop_address: order.parcel_drop_address,
    parcel_description: order.parcel_description,
    created_at_ms: order.created_at_ms,
    delivery_deadline_ms: order.delivery_deadline_ms,
    assignment_id: assignment?.id || null,
    assignment_status: assignment?.status || null,
    assigned_rider_id: assignment?.rider_id || null,
    assigned_rider: assignment?.rider_name || null,
    items: order.items.map(item => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      shop_id: item.shop_id,
      pickup_source_name: item.pickup_source_name,
      pickup_source_address: item.pickup_source_address
    })),
    fulfillments: order.fulfillments.map(fulfillment => ({
      id: fulfillment.id,
      shop_id: fulfillment.shop_id,
      shop_name: fulfillment.shop_name,
      pickup_address: fulfillment.pickup_address,
      status: fulfillment.status
    }))
  };
}

async function listAdminDeliveryOrders(req, res) {
  const bucket = String(req.query.bucket || "active").toLowerCase();
  if (!["active", "past", "all"].includes(bucket)) {
    return respondError(res, 400, "bucket must be active, past, or all.");
  }
  let statusFilter = "";
  const values = [];
  if (bucket === "active") statusFilter = "WHERE o.status = ANY($1::text[])", values.push(ACTIVE_STATUSES);
  if (bucket === "past") statusFilter = "WHERE o.status = ANY($1::text[])", values.push(PAST_STATUSES);
  try {
    const result = await db.query(
      `${ORDER_PROJECTION}
       ${statusFilter}
       ORDER BY o.placed_at DESC
       LIMIT 200`,
      values
    );
    const orderIds = result.rows.map(row => row.id);
    const assignments = orderIds.length
      ? await db.query(
        `SELECT DISTINCT ON (da.order_id)
                da.order_id, da.id, da.status, r.id AS rider_id, u.display_name AS rider_name
         FROM delivery_assignments da
         JOIN riders r ON r.id = da.rider_id
         JOIN users u ON u.id = r.user_id
         WHERE da.order_id = ANY($1::uuid[])
         ORDER BY da.order_id, da.assigned_at DESC, da.id DESC`,
        [orderIds]
      )
      : { rows: [] };
    const assignmentByOrder = new Map(assignments.rows.map(assignment => [assignment.order_id, assignment]));
    return res.json({
      success: true,
      data: result.rows.map(row => presentAdminDeliveryOrder(row, assignmentByOrder.get(row.id)))
    });
  } catch (error) {
    console.error("Admin delivery order listing failed:", error.message);
    return respondError(res, 500, "Unable to retrieve delivery orders.");
  }
}

async function createDeliveryAssignment(req, res) {
  const orderId = req.body?.order_id;
  const riderId = req.body?.rider_id;
  if (!validateUuid(orderId) || !validateUuid(riderId)) return respondError(res, 400, "Valid order_id and rider_id are required.");

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const orderResult = await client.query(
      `SELECT o.id, o.order_number, o.status, o.order_type, o.customer_user_id
       FROM orders o WHERE o.id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = orderResult.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Order not found.");
    }

    const activeResult = await client.query(
      `SELECT id FROM delivery_assignments
       WHERE order_id = $1 AND status = ANY($2::text[])
       LIMIT 1`,
      [orderId, ACTIVE_ASSIGNMENT_STATUSES]
    );
    if (activeResult.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Order already has an active delivery assignment.");
    }

    let assignmentFulfillmentId = null;
    if (order.order_type === "PARCEL") {
      if (!["PLACED", "ACCEPTED"].includes(order.status)) {
        await client.query("ROLLBACK");
        return respondError(res, 409, "Parcel order is not ready for assignment.");
      }
    } else {
      const fulfillmentResult = await client.query(
        `SELECT id, status FROM order_fulfillments
         WHERE order_id = $1 ORDER BY created_at, id FOR UPDATE`,
        [orderId]
      );
      if (order.status !== "READY_FOR_PICKUP" || !fulfillmentResult.rows.length
          || fulfillmentResult.rows.some(row => row.status !== "READY_FOR_PICKUP")) {
        await client.query("ROLLBACK");
        return respondError(res, 409, "All partner fulfillments must be READY_FOR_PICKUP before assignment.");
      }
      if (fulfillmentResult.rows.length === 1) assignmentFulfillmentId = fulfillmentResult.rows[0].id;
    }

    const riderResult = await client.query(
      `SELECT r.id, r.user_id FROM riders r JOIN users u ON u.id = r.user_id
       WHERE r.id = $1 AND r.deleted_at IS NULL
         AND r.verification_status = 'APPROVED' AND r.is_available = true
         AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM rider_availability availability
           WHERE availability.rider_id = r.id
             AND availability.is_available = true AND availability.ended_at IS NULL
         )
       FOR UPDATE OF r`,
      [riderId]
    );
    const rider = riderResult.rows[0];
    if (!rider) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Rider is not approved, active, and available.");
    }

    const riderActive = await client.query(
      `SELECT id FROM delivery_assignments
       WHERE rider_id = $1 AND status = ANY($2::text[])
       LIMIT 1 FOR UPDATE`,
      [riderId, ACTIVE_ASSIGNMENT_STATUSES]
    );
    if (riderActive.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Rider already has an active delivery assignment.");
    }

    const result = await client.query(
      `INSERT INTO delivery_assignments (order_id, fulfillment_id, rider_id, status, assigned_by_user_id)
       VALUES ($1, $2, $3, 'OFFERED', $4)
       RETURNING id, order_id, fulfillment_id, rider_id, status, assigned_at`,
      [orderId, assignmentFulfillmentId, riderId, req.admin.id]
    );
    const assignment = result.rows[0];
    await client.query(
      `INSERT INTO delivery_tracking (assignment_id, event_type, actor_user_id, details)
       VALUES ($1, 'ASSIGNED', $2, $3::jsonb)`,
      [assignment.id, req.admin.id, JSON.stringify({ order_number: order.order_number })]
    );
    await insertNotification(client, rider.user_id, "Delivery assigned", `Order ${order.order_number} is available for acceptance.`, {
      event: "delivery.assignment.offered", order_id: order.id, assignment_id: assignment.id, recipient_type: "RIDER"
    });
    await insertNotification(client, order.customer_user_id, "Rider assigned", `A rider has been assigned to order ${order.order_number}.`, {
      event: "delivery.assignment.offered", order_id: order.id, assignment_id: assignment.id, recipient_type: "CUSTOMER"
    });
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: assignment });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return respondError(res, 409, "Order already has an active delivery assignment.");
    console.error("Delivery assignment creation failed:", error.message);
    return respondError(res, 500, "Unable to create delivery assignment.");
  } finally {
    client?.release();
  }
}

function presentRiderDelivery(row, riderName) {
  const fulfillments = Array.isArray(row.fulfillments) ? row.fulfillments : [];
  const pickupReached = {};
  const pickupProgress = {};
  for (const fulfillment of fulfillments) {
    pickupReached[fulfillment.id] = Boolean(fulfillment.arrived);
    pickupProgress[fulfillment.id] = fulfillment.status === "PICKING_UP";
  }
  if (row.order_type === "PARCEL") {
    const parcelPickupRecorded = ["PICKING_UP", "OUT_FOR_DELIVERY", "COMPLETED"].includes(row.assignment_status);
    pickupReached.parcel = parcelPickupRecorded;
    pickupProgress.parcel = parcelPickupRecorded;
  }
  return {
    ...row,
    assigned_rider: riderName,
    pickup_reached: pickupReached,
    pickup_progress: pickupProgress,
    created_at_ms: row.assigned_at ? new Date(row.assigned_at).getTime() : null,
    total_amount: Number(row.total_amount),
    rider_tip: Number(row.rider_tip || 0),
    items: Array.isArray(row.items) ? row.items : [],
    fulfillments
  };
}

async function listRiderDeliveries(req, res) {
  const bucket = String(req.query.bucket || "active").toLowerCase();
  if (!["active", "past", "all"].includes(bucket)) return respondError(res, 400, "bucket must be active, past, or all.");
  try {
    const rider = await resolveApprovedRider(req.user.id);
    if (!rider) return respondError(res, 403, "An approved rider profile is required.");
    let filter = "";
    if (bucket === "active") filter = "AND da.status = ANY($2::text[])";
    if (bucket === "past") filter = "AND da.status = ANY($2::text[])";
    const params = bucket === "all" ? [rider.id] : [rider.id, bucket === "past"
      ? ["REJECTED", "COMPLETED", "CANCELLED"]
      : ACTIVE_ASSIGNMENT_STATUSES];
    const result = await db.query(
      `${RIDER_ORDER_PROJECTION}
       WHERE da.rider_id = $1 ${filter}
       ORDER BY da.assigned_at DESC
       LIMIT 100`,
      params
    );
    return res.json({ success: true, data: result.rows.map(row => presentRiderDelivery(row, rider.display_name)) });
  } catch (error) {
    console.error("Rider delivery listing failed:", error.message);
    return respondError(res, 500, "Unable to retrieve rider deliveries.");
  }
}

async function lockRiderAssignment(client, userId, assignmentId) {
  const rider = await resolveApprovedRider(userId, client);
  if (!rider) return { error: { status: 403, message: "An approved rider profile is required." } };
  const result = await client.query(
    `SELECT da.id, da.order_id, da.rider_id, da.status AS assignment_status,
            da.accepted_at, o.order_number, o.order_type, o.status AS order_status,
            o.customer_user_id, o.delivery_code, o.delivery_code_hmac,
            o.delivery_code_generated_at, o.delivery_code_verified_at,
            o.delivery_code_attempt_count
     FROM delivery_assignments da JOIN orders o ON o.id = da.order_id
     WHERE da.id = $1 AND da.rider_id = $2
     FOR UPDATE OF da, o`,
    [assignmentId, rider.id]
  );
  if (!result.rows[0]) return { error: { status: 404, message: "Delivery assignment not found." } };
  return { rider, assignment: result.rows[0] };
}

async function writeOrderStatus(client, req, orderId, nextStatus, reason) {
  await client.query(
    `SELECT set_config('app.user_id', $1, true),
            set_config('app.change_source', 'RIDER_API', true),
            set_config('app.change_reason', $2, true)`,
    [req.user.id, reason]
  );
  await client.query("UPDATE orders SET status = $2, updated_at = now() WHERE id = $1", [orderId, nextStatus]);
}

async function recordDeliveryEvent(client, assignment, req, eventType, details = {}, coordinates = null) {
  await client.query(
    `INSERT INTO delivery_tracking (assignment_id, event_type, actor_user_id, latitude, longitude, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [assignment.id, eventType, req.user.id, coordinates?.latitude ?? null, coordinates?.longitude ?? null, JSON.stringify(details)]
  );
}

async function riderDecision(req, res, decision) {
  const assignmentId = req.params.assignmentId;
  if (!validateUuid(assignmentId)) return respondError(res, 400, "Invalid assignment id.");
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : null;
  if (decision === "REJECTED" && !reason) return respondError(res, 400, "A rejection reason is required.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const locked = await lockRiderAssignment(client, req.user.id, assignmentId);
    if (locked.error) {
      await client.query("ROLLBACK");
      return respondError(res, locked.error.status, locked.error.message);
    }
    const { rider, assignment } = locked;
    if (["CANCELLED", "REJECTED", "DELIVERED"].includes(assignment.order_status)) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "The order is no longer eligible for rider action.");
    }
    if (assignment.assignment_status !== "OFFERED") {
      await client.query("ROLLBACK");
      return respondError(res, 409, `Assignment is already ${assignment.assignment_status}.`);
    }
    if (decision === "ACCEPTED" && !(await hasCurrentRiderAvailability(rider.id, client))) {
      await client.query("ROLLBACK");
      return respondError(res, 403, "Rider must be online to accept a new delivery offer.");
    }
    if (decision === "ACCEPTED") {
      const activeAssignments = await getRiderActiveAssignments(client, rider.id, assignment.id);
      if (activeAssignments.length > 0) {
        await client.query("ROLLBACK");
        return respondError(res, 409, "You already have an active delivery. Complete it before accepting another one.");
      }
    }

    await client.query(
      `UPDATE delivery_assignments
       SET status = $2, accepted_at = CASE WHEN $2 = 'ACCEPTED' THEN now() ELSE accepted_at END,
           rejection_reason = CASE WHEN $2 = 'REJECTED' THEN $3 ELSE rejection_reason END,
           updated_at = now()
       WHERE id = $1`,
      [assignment.id, decision, reason]
    );
    await recordDeliveryEvent(client, assignment, req, decision, reason ? { reason } : {});
    const title = decision === "ACCEPTED" ? "Rider accepted delivery" : "Rider rejected delivery";
    const message = decision === "ACCEPTED"
      ? `A rider accepted order ${assignment.order_number}.`
      : `The rider could not accept order ${assignment.order_number}; reassignment is pending.`;
    await insertNotification(client, assignment.customer_user_id, title, message, {
      event: `delivery.assignment.${decision.toLowerCase()}`,
      order_id: assignment.order_id,
      assignment_id: assignment.id,
      recipient_type: "CUSTOMER"
    });
    await insertNotification(client, req.user.id, title, message, {
      event: `delivery.assignment.${decision.toLowerCase()}`,
      order_id: assignment.order_id,
      assignment_id: assignment.id,
      recipient_type: "RIDER"
    });
    if (assignment.order_type === "PARCEL" && decision === "ACCEPTED" && assignment.order_status === "PLACED") {
      await writeOrderStatus(client, req, assignment.order_id, "ACCEPTED", "Rider accepted parcel delivery");
    }
    await client.query("COMMIT");
    return res.json({ success: true, data: { assignment_id: assignment.id, status: decision } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error(`Rider assignment ${decision.toLowerCase()} failed:`, error.message);
    return respondError(res, 500, `Unable to ${decision === "ACCEPTED" ? "accept" : "reject"} delivery assignment.`);
  } finally {
    client?.release();
  }
}

async function acceptDelivery(req, res) {
  return riderDecision(req, res, "ACCEPTED");
}

async function rejectDelivery(req, res) {
  return riderDecision(req, res, "REJECTED");
}

async function arriveAtPickup(req, res) {
  const assignmentId = req.params.assignmentId;
  const fulfillmentId = req.params.fulfillmentId;
  if (!validateUuid(assignmentId) || !validateUuid(fulfillmentId)) return respondError(res, 400, "Invalid assignment or fulfillment id.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const locked = await lockRiderAssignment(client, req.user.id, assignmentId);
    if (locked.error) {
      await client.query("ROLLBACK");
      return respondError(res, locked.error.status, locked.error.message);
    }
    const { assignment } = locked;
    if (!["ACCEPTED", "PICKING_UP"].includes(assignment.assignment_status)) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Only an accepted delivery can record pickup arrival.");
    }
    const fulfillmentResult = await client.query(
      `SELECT id, status FROM order_fulfillments
       WHERE id = $1 AND order_id = $2 FOR UPDATE`,
      [fulfillmentId, assignment.order_id]
    );
    const fulfillment = fulfillmentResult.rows[0];
    if (!fulfillment) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Fulfillment not found for this delivery.");
    }
    if (fulfillment.status !== "READY_FOR_PICKUP") {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Partner must mark this fulfillment READY_FOR_PICKUP first.");
    }
    const alreadyArrived = await client.query(
      `SELECT id FROM delivery_tracking
       WHERE assignment_id = $1 AND event_type = 'ARRIVED_AT_PICKUP'
         AND details->>'fulfillment_id' = $2 LIMIT 1`,
      [assignment.id, fulfillment.id]
    );
    if (!alreadyArrived.rows[0]) {
      await recordDeliveryEvent(client, assignment, req, "ARRIVED_AT_PICKUP", { fulfillment_id: fulfillment.id });
    }
    if (assignment.assignment_status === "ACCEPTED") {
      await client.query("UPDATE delivery_assignments SET status = 'PICKING_UP', updated_at = now() WHERE id = $1", [assignment.id]);
    }
    if (assignment.order_status === "READY_FOR_PICKUP") {
      await writeOrderStatus(client, req, assignment.order_id, "PICKING_UP", "Rider arrived at pickup");
    } else if (assignment.order_type === "PARCEL" && assignment.order_status === "ACCEPTED") {
      await writeOrderStatus(client, req, assignment.order_id, "READY_FOR_PICKUP", "Parcel ready for rider pickup");
      await writeOrderStatus(client, req, assignment.order_id, "PICKING_UP", "Rider arrived at parcel pickup");
    }
    await client.query("COMMIT");
    return res.json({ success: true, data: { assignment_id: assignment.id, fulfillment_id: fulfillment.id, event: "ARRIVED_AT_PICKUP" } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Pickup arrival failed:", error.message);
    return respondError(res, 500, "Unable to record pickup arrival.");
  } finally {
    client?.release();
  }
}

async function arriveAtParcelPickup(req, res) {
  const assignmentId = req.params.assignmentId;
  if (!validateUuid(assignmentId)) return respondError(res, 400, "Invalid assignment id.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const locked = await lockRiderAssignment(client, req.user.id, assignmentId);
    if (locked.error) {
      await client.query("ROLLBACK");
      return respondError(res, locked.error.status, locked.error.message);
    }
    const { assignment } = locked;
    if (assignment.order_type !== "PARCEL") {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Parcel pickup arrival is only valid for parcel orders.");
    }
    if (assignment.assignment_status === "PICKING_UP" && assignment.order_status === "PICKING_UP") {
      await client.query("COMMIT");
      return res.json({ success: true, data: { assignment_id: assignment.id, status: "PICKING_UP" } });
    }
    if (assignment.assignment_status !== "ACCEPTED" || assignment.order_status !== "ACCEPTED") {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Accept the parcel assignment before recording pickup arrival.");
    }
    await recordDeliveryEvent(client, assignment, req, "ARRIVED_AT_PICKUP", { source: "PARCEL_PICKUP" });
    await client.query("UPDATE delivery_assignments SET status = 'PICKING_UP', updated_at = now() WHERE id = $1", [assignment.id]);
    await writeOrderStatus(client, req, assignment.order_id, "READY_FOR_PICKUP", "Parcel pickup confirmed by rider arrival");
    await writeOrderStatus(client, req, assignment.order_id, "PICKING_UP", "Parcel pickup in progress");
    await insertNotification(client, assignment.customer_user_id, "Parcel pickup started", `The rider has arrived for parcel ${assignment.order_number}.`, {
      event: "delivery.pickup.arrived", order_id: assignment.order_id, assignment_id: assignment.id, source: "PARCEL_PICKUP", recipient_type: "CUSTOMER"
    });
    await client.query("COMMIT");
    return res.json({ success: true, data: { assignment_id: assignment.id, status: "PICKING_UP", event: "ARRIVED_AT_PICKUP" } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Parcel pickup arrival failed:", error.message);
    return respondError(res, 500, "Unable to record parcel pickup arrival.");
  } finally {
    client?.release();
  }
}

async function confirmPickup(req, res) {
  const assignmentId = req.params.assignmentId;
  const fulfillmentId = req.params.fulfillmentId;
  const code = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!validateUuid(assignmentId) || !validateUuid(fulfillmentId)) return respondError(res, 400, "Invalid assignment or fulfillment id.");
  if (!/^\d{6}$/.test(code)) return respondError(res, 400, "A valid pickup code is required.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const locked = await lockRiderAssignment(client, req.user.id, assignmentId);
    if (locked.error) {
      await client.query("ROLLBACK");
      return respondError(res, locked.error.status, locked.error.message);
    }
    const { assignment } = locked;
    if (!["PICKING_UP", "OUT_FOR_DELIVERY"].includes(assignment.assignment_status)) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Assignment is not in pickup state.");
    }
    const fulfillmentResult = await client.query(
      `SELECT id, status, pickup_otp_hmac, pickup_otp_expires_at, pickup_otp_verified_at
       FROM order_fulfillments WHERE id = $1 AND order_id = $2 FOR UPDATE`,
      [fulfillmentId, assignment.order_id]
    );
    const fulfillment = fulfillmentResult.rows[0];
    if (!fulfillment) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Fulfillment not found for this delivery.");
    }
    if (fulfillment.status === "PICKING_UP" && fulfillment.pickup_otp_verified_at) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Pickup code has already been used.");
    }
    if (fulfillment.status !== "READY_FOR_PICKUP" || !fulfillment.pickup_otp_hmac
        || !fulfillment.pickup_otp_expires_at || new Date(fulfillment.pickup_otp_expires_at) <= new Date()) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "A valid pickup code is not available for this fulfillment.");
    }
    const arrivalResult = await client.query(
      `SELECT id FROM delivery_tracking
       WHERE assignment_id = $1 AND event_type = 'ARRIVED_AT_PICKUP'
         AND details->>'fulfillment_id' = $2 LIMIT 1`,
      [assignment.id, fulfillment.id]
    );
    if (!arrivalResult.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Record pickup arrival before confirming the pickup code.");
    }
    const challengeKey = `pickup:${fulfillment.id}`;
    const challengeResult = await client.query(
      `SELECT id, otp_hmac, attempt_count, max_attempts
       FROM otp_verifications
       WHERE destination = $1 AND purpose = 'PICKUP' AND consumed_at IS NULL
         AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [challengeKey]
    );
    const challenge = challengeResult.rows[0];
    if (!challenge || challenge.attempt_count >= challenge.max_attempts) {
      await client.query("ROLLBACK");
      return respondError(res, 429, "Pickup code attempts are exhausted or the code has expired.");
    }
    const matches = matchesOtp(challenge.otp_hmac, challengeKey, "PICKUP", code)
      && Buffer.from(fulfillment.pickup_otp_hmac).equals(Buffer.from(challenge.otp_hmac));
    if (!matches) {
      await client.query("UPDATE otp_verifications SET attempt_count = attempt_count + 1 WHERE id = $1", [challenge.id]);
      await client.query("COMMIT");
      return respondError(res, 400, "Pickup code is invalid.");
    }
    await client.query("UPDATE otp_verifications SET consumed_at = now() WHERE id = $1", [challenge.id]);
    await client.query(
      `UPDATE order_fulfillments
       SET status = 'PICKING_UP', pickup_otp_verified_at = now(), updated_at = now()
       WHERE id = $1`,
      [fulfillment.id]
    );
    await client.query(
      `INSERT INTO fulfillment_status_history (fulfillment_id, from_status, to_status, changed_by_user_id, reason)
       VALUES ($1, 'READY_FOR_PICKUP', 'PICKING_UP', $2, 'Pickup code verified by assigned rider')`,
      [fulfillment.id, req.user.id]
    );
    await recordDeliveryEvent(client, assignment, req, "PICKUP_CONFIRMED", { fulfillment_id: fulfillment.id });
    await insertNotification(client, assignment.customer_user_id, "Pickup confirmed", `A pickup has been confirmed for order ${assignment.order_number}.`, {
      event: "delivery.pickup.confirmed", order_id: assignment.order_id, assignment_id: assignment.id, fulfillment_id: fulfillment.id, recipient_type: "CUSTOMER"
    });
    await client.query("COMMIT");
    return res.json({ success: true, data: { fulfillment_id: fulfillment.id, status: "PICKING_UP" } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Pickup confirmation failed:", error.message);
    return respondError(res, 500, "Unable to confirm pickup.");
  } finally {
    client?.release();
  }
}

async function startOutForDelivery(req, res) {
  const assignmentId = req.params.assignmentId;
  if (!validateUuid(assignmentId)) return respondError(res, 400, "Invalid assignment id.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const locked = await lockRiderAssignment(client, req.user.id, assignmentId);
    if (locked.error) {
      await client.query("ROLLBACK");
      return respondError(res, locked.error.status, locked.error.message);
    }
    const { assignment } = locked;
    if (assignment.assignment_status === "OUT_FOR_DELIVERY" && assignment.order_status === "OUT_FOR_DELIVERY") {
      await client.query("COMMIT");
      return res.json({ success: true, data: { assignment_id: assignment.id, status: "OUT_FOR_DELIVERY" } });
    }
    if (assignment.assignment_status !== "PICKING_UP") {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Complete the pickup stage before starting delivery.");
    }
    const unpicked = await client.query(
      `SELECT count(*)::int AS count FROM order_fulfillments
       WHERE order_id = $1 AND status <> 'PICKING_UP'`,
      [assignment.order_id]
    );
    if (unpicked.rows[0].count > 0) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Every partner fulfillment must be picked up before delivery starts.");
    }
    if (assignment.order_status !== "PICKING_UP") {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Order is not in the pickup state.");
    }
    await client.query("UPDATE delivery_assignments SET status = 'OUT_FOR_DELIVERY', updated_at = now() WHERE id = $1", [assignment.id]);
    await writeOrderStatus(client, req, assignment.order_id, "OUT_FOR_DELIVERY", "Rider started delivery");
    await client.query("UPDATE orders SET dispatched_at = COALESCE(dispatched_at, now()) WHERE id = $1", [assignment.order_id]);
    await recordDeliveryEvent(client, assignment, req, "OUT_FOR_DELIVERY");
    await insertNotification(client, assignment.customer_user_id, "Order is out for delivery", `Order ${assignment.order_number} is on its way.`, {
      event: "delivery.out_for_delivery", order_id: assignment.order_id, assignment_id: assignment.id, recipient_type: "CUSTOMER"
    });
    await client.query("COMMIT");
    return res.json({ success: true, data: { assignment_id: assignment.id, status: "OUT_FOR_DELIVERY" } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Out-for-delivery transition failed:", error.message);
    return respondError(res, 500, "Unable to start delivery.");
  } finally {
    client?.release();
  }
}

async function issuePickupOtp(req, res) {
  const orderId = req.params.orderId;
  const shopId = req.params.shopId;
  if (!validateUuid(orderId) || !validateUuid(shopId)) return respondError(res, 400, "Invalid order or shop id.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const targetResult = await client.query(
      `SELECT f.id AS fulfillment_id, f.status, f.pickup_otp_expires_at,
              s.phone_e164 AS pickup_phone
       FROM order_fulfillments f
       JOIN shops s ON s.id = f.shop_id
       WHERE f.order_id = $1 AND f.shop_id = $2
         AND s.partner_id = ANY($3::uuid[]) AND s.deleted_at IS NULL
       LIMIT 1 FOR UPDATE OF f`,
      [orderId, shopId, req.partnerIds]
    );
    const target = targetResult.rows[0];
    if (!target) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Fulfillment not found.");
    }
    if (target.status !== "READY_FOR_PICKUP") {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Pickup code is available only after the partner marks the fulfillment ready.");
    }
    if (!target.pickup_phone) {
      await client.query("ROLLBACK");
      return respondError(res, 503, "Pickup code delivery is not configured for this shop.");
    }
    const destination = `pickup:${target.fulfillment_id}`;
    if (await deliveryOtpRequestCount(client, destination, "PICKUP") >= OTP_MAX_REQUESTS_PER_WINDOW) {
      await client.query("ROLLBACK");
      return respondError(res, 429, "Pickup code request limit exceeded.");
    }
    const code = generateOtp();
    const digest = hashOtp(destination, "PICKUP", code);
    const delivery = await sendOtp({ destination: target.pickup_phone, purpose: "PICKUP", code });
    if (!delivery?.delivered) {
      await client.query("ROLLBACK");
      return respondError(res, 503, "Pickup code delivery is not configured.");
    }
    await client.query(
      `INSERT INTO otp_verifications (user_id, destination, channel, purpose, otp_hmac, expires_at, max_attempts)
       VALUES ($1, $2, 'SMS', 'PICKUP', $3, now() + ($4::int * interval '1 millisecond'), $5)`,
      [req.user.id, destination, digest, OTP_TTL_MS, OTP_MAX_ATTEMPTS]
    );
    await client.query(
      `UPDATE order_fulfillments
       SET pickup_otp_hmac = $2, pickup_otp_expires_at = now() + ($3::int * interval '1 millisecond'),
           pickup_otp_verified_at = NULL, updated_at = now()
       WHERE id = $1`,
      [target.fulfillment_id, digest, OTP_TTL_MS]
    );
    await client.query("COMMIT");
    return res.json({ success: true, message: "Pickup code sent to the partner contact.", data: { expires_in_seconds: OTP_TTL_MS / 1000 } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "OTP_DELIVERY_UNAVAILABLE") return respondError(res, 503, "Pickup code delivery is not configured.");
    console.error("Pickup code issuance failed:", error.message);
    return respondError(res, 500, "Unable to issue pickup code.");
  } finally {
    client?.release();
  }
}

async function issueDeliveryOtp(req, res) {
  const orderId = req.params.orderId;
  if (!validateUuid(orderId)) return respondError(res, 400, "Invalid order id.");
  try {
    const orderResult = await db.query(
      `SELECT id, customer_user_id, status
       FROM orders
       WHERE id = $1 AND customer_user_id = $2`,
      [orderId, req.user.id]
    );
    const order = orderResult.rows[0];
    if (!order) {
      return respondError(res, 404, "Order not found.");
    }
    return respondError(res, 410, "Delivery codes are generated when the order is placed and are shown only to the customer.");
  } catch (error) {
    console.error("Legacy delivery code issuance failed:", error.message);
    return respondError(res, 500, "Unable to issue delivery code.");
  }
}

async function verifyDeliveryCode(req, res) {
  const assignmentId = req.params.assignmentId;
  const code = typeof req.body?.delivery_code === "string"
    ? req.body.delivery_code.trim()
    : typeof req.body?.code === "string"
      ? req.body.code.trim()
      : typeof req.body?.otp === "string"
        ? req.body.otp.trim()
        : "";
  if (!validateUuid(assignmentId)) return respondError(res, 400, "Invalid assignment id.");
  if (!/^\d{4}$/.test(code)) return respondError(res, 400, "A valid 4-digit delivery code is required.");

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const locked = await lockRiderAssignment(client, req.user.id, assignmentId);
    if (locked.error) {
      await client.query("ROLLBACK");
      return respondError(res, locked.error.status, locked.error.message);
    }

    const { assignment } = locked;
    if (assignment.assignment_status === "COMPLETED" && assignment.order_status === "DELIVERED") {
      await client.query("ROLLBACK");
      return respondError(res, 409, "This delivery has already been completed.");
    }
    if (assignment.assignment_status !== "OUT_FOR_DELIVERY" || assignment.order_status !== "OUT_FOR_DELIVERY") {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Only an out-for-delivery assignment can be completed.");
    }
    if (!assignment.delivery_code_hmac || !assignment.delivery_code_generated_at) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "A valid delivery code is not available for this order.");
    }
    const maxAttempts = 3;
    const currentAttemptCount = Number(assignment.delivery_code_attempt_count || 0);
    if (currentAttemptCount >= maxAttempts) {
      await client.query("ROLLBACK");
      return respondError(res, 429, "Delivery code verification is locked after 3 failed attempts.");
    }

    const matches = matchesDeliveryCode(assignment.delivery_code_hmac, assignment.order_id, code);
    if (!matches) {
      const nextAttemptCount = currentAttemptCount + 1;
      await client.query(
        `UPDATE orders
         SET delivery_code_attempt_count = $2,
             updated_at = now()
         WHERE id = $1`,
        [assignment.order_id, nextAttemptCount]
      );
      await client.query("COMMIT");
      if (nextAttemptCount >= maxAttempts) {
        return respondError(res, 429, "Delivery code verification is locked after 3 failed attempts.");
      }
      return respondError(res, 400, "Delivery code does not match this order.");
    }

    const earningConfig = await loadRiderEarningConfig(client);
    const earningSnapshot = calculateRiderEarningSnapshot(earningConfig);
    await client.query(
      `UPDATE orders
       SET delivery_code_attempt_count = 0,
           delivery_code_verified_at = now(),
           delivered_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [assignment.order_id]
    );
    await writeOrderStatus(client, req, assignment.order_id, "DELIVERED", "Delivery code verified by assigned rider");
    await client.query(
      `UPDATE delivery_assignments
       SET status = 'COMPLETED', completed_at = now(), updated_at = now()
       WHERE id = $1`,
      [assignment.id]
    );
    await recordDeliveryEvent(client, assignment, req, "DELIVERED", { rider_earning: earningSnapshot });
    await insertNotification(client, assignment.customer_user_id, "Order delivered", `Order ${assignment.order_number} was delivered.`, {
      event: "delivery.delivered", order_id: assignment.order_id, assignment_id: assignment.id, recipient_type: "CUSTOMER"
    });
    await insertNotification(client, req.user.id, "Delivery completed", `Delivery ${assignment.order_number} was completed.`, {
      event: "delivery.completed", order_id: assignment.order_id, assignment_id: assignment.id, recipient_type: "RIDER"
    });
    await client.query("COMMIT");
    return res.json({ success: true, data: { assignment_id: assignment.id, status: "COMPLETED", order_status: "DELIVERED" } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Delivery code verification failed:", error.message);
    return respondError(res, 500, "Unable to verify delivery code.");
  } finally {
    client?.release();
  }
}

async function completeDelivery(req, res) {
  return verifyDeliveryCode(req, res);
}

async function updateRiderLocation(req, res) {
  const assignmentId = req.body?.assignment_id;
  if (!validateUuid(assignmentId)) return respondError(res, 400, "A valid assignment_id is required.");
  const rawLatitude = req.body?.latitude;
  const rawLongitude = req.body?.longitude;
  const isPresentCoordinate = value => typeof value === "number"
    || (typeof value === "string" && value.trim() !== "");
  if (!isPresentCoordinate(rawLatitude) || !isPresentCoordinate(rawLongitude)) {
    return respondError(res, 400, "Latitude and longitude are required.");
  }
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  const accuracy = req.body?.accuracy_m == null ? null : Number(req.body.accuracy_m);
  const heading = req.body?.heading_degrees == null ? null : Number(req.body.heading_degrees);
  const speed = req.body?.speed_mps == null ? null : Number(req.body.speed_mps);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10000))
      || (heading != null && (!Number.isFinite(heading) || heading < 0 || heading > 360))
      || (speed != null && (!Number.isFinite(speed) || speed < 0 || speed > 100))) {
    return respondError(res, 400, "Location coordinates or sensor values are invalid.");
  }
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const rider = await resolveApprovedRider(req.user.id, client);
    if (!rider) {
      await client.query("ROLLBACK");
      return respondError(res, 403, "An approved rider profile is required.");
    }
    const assignmentResult = await client.query(
      `SELECT id FROM delivery_assignments
       WHERE id = $1 AND rider_id = $2
         AND status IN ('ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY')
       FOR UPDATE`,
      [assignmentId, rider.id]
    );
    if (!assignmentResult.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Active assignment not found for this rider.");
    }
    const recent = await client.query(
      `SELECT id FROM rider_locations
       WHERE rider_id = $1 AND assignment_id = $2
         AND recorded_at > now() - interval '2 seconds'
       LIMIT 1`,
      [rider.id, assignmentId]
    );
    if (recent.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 429, "Location update was received too recently.");
    }
    const result = await client.query(
      `INSERT INTO rider_locations (rider_id, assignment_id, latitude, longitude, accuracy_m, heading_degrees, speed_mps)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, recorded_at`,
      [rider.id, assignmentId, latitude, longitude, accuracy, heading, speed]
    );
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Rider location update failed:", error.message);
    return respondError(res, 500, "Unable to save rider location.");
  } finally {
    client?.release();
  }
}

async function getCustomerTracking(req, res) {
  const orderId = req.params.orderId;
  if (!validateUuid(orderId)) return respondError(res, 400, "Invalid order id.");
  try {
    const orderResult = await db.query(
          `SELECT o.id, o.status, o.customer_user_id, o.order_type,
            oa.latitude AS delivery_latitude, oa.longitude AS delivery_longitude,
            oa.postal_code AS delivery_postal_code,
            da.id AS assignment_id, da.status AS assignment_status,
            ru.display_name AS rider_name
       FROM orders o
           LEFT JOIN order_addresses oa ON oa.order_id = o.id
       LEFT JOIN LATERAL (
         SELECT da.* FROM delivery_assignments da
         WHERE da.order_id = o.id AND da.status = ANY($3::text[])
         ORDER BY da.assigned_at DESC LIMIT 1
       ) da ON true
       LEFT JOIN riders r ON r.id = da.rider_id
       LEFT JOIN users ru ON ru.id = r.user_id
       WHERE o.id = $1 AND o.customer_user_id = $2`,
      [orderId, req.user.id, ACTIVE_ASSIGNMENT_STATUSES]
    );
    const order = orderResult.rows[0];
    if (!order) return respondError(res, 404, "Order not found.");
    const etaConfig = await loadEtaConfig(db);
    const customerDeliveryPromiseMinutes = Number.isInteger(etaConfig?.customer_delivery_promise_minutes)
      ? Number(etaConfig.customer_delivery_promise_minutes)
      : 30;
    const visible = ["ACCEPTED", "PICKING_UP", "OUT_FOR_DELIVERY"].includes(order.assignment_status);
    if (!visible || !order.assignment_id) {
      let eta;
      try {
        eta = await calculateCustomerOrderEta(order, db);
      } catch (error) {
        console.error("Customer order ETA unavailable:", error.message);
        eta = unavailableEta("ETA_CONFIGURATION_UNAVAILABLE");
      }
      return res.json({ success: true, data: { available: false, order_status: order.status, eta, customer_delivery_promise_minutes: customerDeliveryPromiseMinutes } });
    }
    const locationResult = await db.query(
      `SELECT latitude, longitude, accuracy_m, heading_degrees, speed_mps, recorded_at
       FROM rider_locations
       WHERE assignment_id = $1 AND expires_at > now()
         AND recorded_at > now() - interval '2 minutes'
       ORDER BY recorded_at DESC LIMIT 1`,
      [order.assignment_id]
    );
    const location = locationResult.rows[0];
    let eta = unavailableEta("RIDER_LOCATION_UNAVAILABLE");
    if (location) {
      try {
        eta = await calculateEta({
          origin: { latitude: location.latitude, longitude: location.longitude },
          destination: { latitude: order.delivery_latitude, longitude: order.delivery_longitude },
          mode: "RIDER_TO_CUSTOMER"
        }, db);
      } catch (error) {
        console.warn("Live rider ETA unavailable:", error.message);
        eta = unavailableEta("ETA_COORDINATES_UNAVAILABLE");
      }
    }
    return res.json({ success: true, data: {
      available: true,
      order_status: order.status,
      assignment_status: order.assignment_status,
      rider_name: order.rider_name,
      location: location ? {
        latitude: Number(location.latitude), longitude: Number(location.longitude),
        accuracy_m: location.accuracy_m == null ? null : Number(location.accuracy_m),
        heading_degrees: location.heading_degrees == null ? null : Number(location.heading_degrees),
        speed_mps: location.speed_mps == null ? null : Number(location.speed_mps),
        recorded_at: location.recorded_at
      } : null,
      eta,
      customer_delivery_promise_minutes: customerDeliveryPromiseMinutes
    } });
  } catch (error) {
    console.error("Customer delivery tracking lookup failed:", error.message);
    return respondError(res, 500, "Unable to retrieve delivery tracking.");
  }
}

async function getAdminAssignmentTracking(req, res) {
  const assignmentId = req.params.assignmentId;
  if (!validateUuid(assignmentId)) return respondError(res, 400, "Invalid assignment id.");
  try {
    const result = await db.query(
      `SELECT da.id AS assignment_id, da.order_id, da.status AS assignment_status,
              o.status AS order_status, o.order_number, o.order_type,
              u.display_name AS rider_name, u.phone_e164 AS rider_phone_e164,
              r.vehicle_type AS rider_vehicle_type,
              loc.latitude, loc.longitude, loc.accuracy_m, loc.heading_degrees,
              loc.speed_mps, loc.recorded_at
       FROM delivery_assignments da
       JOIN orders o ON o.id = da.order_id
       JOIN riders r ON r.id = da.rider_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, accuracy_m, heading_degrees, speed_mps, recorded_at
         FROM rider_locations
         WHERE assignment_id = da.id AND expires_at > now()
           AND recorded_at > now() - interval '2 minutes'
         ORDER BY recorded_at DESC LIMIT 1
       ) loc ON true
       WHERE da.id = $1`,
      [assignmentId]
    );
    const row = result.rows[0];
    if (!row) return respondError(res, 404, "Delivery assignment not found.");
    return res.json({ success: true, data: {
      assignment_id: row.assignment_id,
      order_id: row.order_id,
      order_number: row.order_number,
      order_type: row.order_type,
      assignment_status: row.assignment_status,
      order_status: row.order_status,
      rider_name: row.rider_name,
      rider_phone_e164: row.rider_phone_e164,
      rider_vehicle_type: row.rider_vehicle_type,
      location: row.latitude == null ? null : {
        latitude: Number(row.latitude), longitude: Number(row.longitude),
        accuracy_m: row.accuracy_m == null ? null : Number(row.accuracy_m),
        heading_degrees: row.heading_degrees == null ? null : Number(row.heading_degrees),
        speed_mps: row.speed_mps == null ? null : Number(row.speed_mps),
        recorded_at: row.recorded_at
      }
    } });
  } catch (error) {
    console.error("Admin delivery tracking lookup failed:", error.message);
    return respondError(res, 500, "Unable to retrieve delivery tracking.");
  }
}

module.exports = {
  resolveApprovedRider,
  listAdminDeliveryOrders,
  listAdminDeliveryOrders,
  listEligibleRiders,
  createDeliveryAssignment,
  listRiderDeliveries,
  acceptDelivery,
  rejectDelivery,
  arriveAtPickup,
  arriveAtParcelPickup,
  confirmPickup,
  startOutForDelivery,
  issuePickupOtp,
  issueDeliveryOtp,
  verifyDeliveryCode,
  completeDelivery,
  updateRiderLocation,
  getCustomerTracking,
  getAdminAssignmentTracking
};