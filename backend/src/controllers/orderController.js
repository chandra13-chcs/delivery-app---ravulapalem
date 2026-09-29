"use strict";

const crypto = require("crypto");
const db = require("../config/db");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_STATUSES = ["DRAFT", "PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "PICKING_UP", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"];
const PAST_STATUSES = ["DELIVERED", "CANCELLED", "REJECTED"];

const ORDER_PROJECTION = `
  SELECT o.id, o.order_number, o.customer_user_id, o.status, o.order_type,
         o.currency, o.subtotal, o.delivery_fee, o.tax_amount, o.discount_amount,
         o.rider_tip, o.total_amount, o.customer_note, o.cancellation_reason,
         o.placed_at, o.accepted_at, o.dispatched_at, o.delivered_at, o.cancelled_at,
         u.display_name AS customer_name, u.phone_e164 AS customer_phone,
         oa.recipient_name, oa.recipient_phone_e164, oa.address_line1, oa.address_line2,
         oa.landmark, oa.locality, oa.city, oa.state, oa.postal_code, oa.country_code,
         oa.latitude AS delivery_latitude, oa.longitude AS delivery_longitude,
         COALESCE(payment.method, 'COD') AS payment_method,
         parcel.parcel_pickup_address, parcel.parcel_drop_address, parcel.parcel_description,
         COALESCE(item_data.items, '[]'::jsonb) AS items,
         COALESCE(fulfillment_data.items, '[]'::jsonb) AS fulfillments,
         rider.assignment_id, rider.assignment_status,
         rider.rider_id, rider.rider_name, rider.rider_phone
  FROM orders o
  JOIN users u ON u.id = o.customer_user_id
  LEFT JOIN order_addresses oa ON oa.order_id = o.id
  LEFT JOIN LATERAL (
    SELECT p.method
    FROM payments p
    WHERE p.order_id = o.id
    ORDER BY p.created_at DESC
    LIMIT 1
  ) payment ON true
  LEFT JOIN parcel_details parcel ON parcel.order_id = o.id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'product_id', oi.product_id,
        'variant_id', oi.variant_id,
        'name', oi.product_name_snapshot,
        'variant_name', oi.variant_name_snapshot,
        'sku', oi.sku_snapshot,
        'unit', oi.unit_snapshot,
        'quantity', oi.quantity,
        'price', oi.unit_price,
        'discount_amount', oi.discount_amount,
        'tax_amount', oi.tax_amount,
        'line_total', oi.line_total,
        'shop_id', f.shop_id,
        'pickup_source_name', f.shop_name_snapshot,
        'pickup_source_address', f.pickup_address_snapshot
      ) ORDER BY oi.created_at ASC, oi.id ASC
    ) AS items
    FROM order_items oi
    LEFT JOIN order_fulfillments f ON f.id = oi.fulfillment_id
    WHERE oi.order_id = o.id
  ) item_data ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'shop_id', f.shop_id,
        'shop_name', f.shop_name_snapshot,
        'pickup_address', f.pickup_address_snapshot,
        'status', f.status,
        'created_at', f.created_at
      ) ORDER BY f.created_at ASC, f.id ASC
    ) AS items
    FROM order_fulfillments f
    WHERE f.order_id = o.id
  ) fulfillment_data ON true
  LEFT JOIN LATERAL (
    SELECT assignment.id AS assignment_id, assignment.status AS assignment_status,
           CASE WHEN assignment.status <> 'OFFERED' THEN r.id END AS rider_id,
           CASE WHEN assignment.status <> 'OFFERED' THEN rider_user.display_name END AS rider_name,
           CASE WHEN assignment.status <> 'OFFERED' THEN rider_user.phone_e164 END AS rider_phone
    FROM delivery_assignments assignment
    JOIN riders r ON r.id = assignment.rider_id
    JOIN users rider_user ON rider_user.id = r.user_id
    WHERE assignment.order_id = o.id
      AND assignment.status IN ('OFFERED', 'ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY')
    ORDER BY assignment.assigned_at DESC
    LIMIT 1
  ) rider ON true`;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeCartLines(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) {
    throw httpError(400, "A cart with 1 to 100 items is required.");
  }

  return input.map(item => {
    const productId = item?.product_id || item?.id;
    const variantId = item?.variant_id || null;
    const quantity = Number(item?.quantity);
    const selectedWeight = item?.selected_weight == null || item.selected_weight === ""
      ? null
      : Number(item.selected_weight);
    if (!UUID_PATTERN.test(String(productId || ""))
        || (variantId != null && !UUID_PATTERN.test(String(variantId)))
        || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000
        || (selectedWeight != null && (!Number.isFinite(selectedWeight) || selectedWeight <= 0))) {
      throw httpError(400, "Cart item identifiers, quantities, or variants are invalid.");
    }
    return { productId, variantId, quantity, selectedWeight };
  });
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (/^\+[1-9][0-9]{7,14}$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return null;
}

function normalizeAddress(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpError(400, "A delivery address is required.");
  }
  const recipientName = String(input.recipient_name || input.fullName || "").trim();
  const phone = normalizePhone(input.recipient_phone_e164 || input.mobile);
  const addressLine1 = String(input.address_line1 || [input.house, input.street].filter(Boolean).join(", ")).trim();
  const addressLine2 = input.address_line2 ?? input.street ?? null;
  const city = String(input.city || "").trim();
  const state = String(input.state || "").trim();
  const postalCode = String(input.postal_code || input.pincode || "").trim();
  const countryCode = String(input.country_code || "IN").toUpperCase();
  const latitude = input.latitude == null ? null : Number(input.latitude);
  const longitude = input.longitude == null ? null : Number(input.longitude);

  if (!recipientName || recipientName.length > 200 || !phone || !addressLine1
      || !city || !state || !postalCode || postalCode.length > 16
      || !/^[A-Z]{2}$/.test(countryCode)
      || (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
      || (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    throw httpError(400, "The delivery address is incomplete or invalid.");
  }
  return {
    recipientName,
    phone,
    addressLine1,
    addressLine2: addressLine2 == null ? null : String(addressLine2).trim() || null,
    landmark: input.landmark == null ? null : String(input.landmark).trim() || null,
    locality: input.locality || input.district ? String(input.locality || input.district).trim() : null,
    city,
    state,
    postalCode,
    countryCode,
    latitude,
    longitude
  };
}

function normalizeParcelCoordinates(parcel, prefix) {
  const latitude = parcel?.[`${prefix}_latitude`];
  const longitude = parcel?.[`${prefix}_longitude`];
  if (latitude == null && longitude == null) return null;
  const normalizedLatitude = Number(latitude);
  const normalizedLongitude = Number(longitude);
  if (latitude == null || longitude == null
      || !Number.isFinite(normalizedLatitude) || normalizedLatitude < -90 || normalizedLatitude > 90
      || !Number.isFinite(normalizedLongitude) || normalizedLongitude < -180 || normalizedLongitude > 180) {
    throw httpError(400, `Parcel ${prefix} coordinates are invalid.`);
  }
  return { latitude: normalizedLatitude, longitude: normalizedLongitude };
}

function normalizePaymentMethod(value) {
  const method = String(value || "COD").toUpperCase();
  if (method === "COD") return "COD";
  if (["UPI", "UPI_QR", "UPI_APPS"].includes(method)) return "UPI";
  throw httpError(400, "Payment method must be COD or UPI.");
}

function presentOrder(row) {
  const placedAt = row.placed_at ? new Date(row.placed_at) : null;
  const createdAtMs = placedAt && Number.isFinite(placedAt.getTime()) ? placedAt.getTime() : null;
  const addressParts = [row.address_line1, row.address_line2, row.landmark, row.locality, row.city, row.state, row.postal_code]
    .filter(Boolean);
  const items = Array.isArray(row.items) ? row.items : [];
  if (row.order_type === "PARCEL" && items.length === 0 && row.parcel_description) {
    items.push({
      name: `Parcel: ${row.parcel_description}`,
      unit: "1 parcel",
      quantity: 1,
      price: Number(row.subtotal),
      line_total: Number(row.subtotal),
      pickup_source_name: "Parcel Pickup",
      pickup_source_address: row.parcel_pickup_address
    });
  }
  return {
    id: row.id,
    order_number: row.order_number,
    customer_user_id: row.customer_user_id,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    status: row.status,
    order_type: row.order_type,
    currency: row.currency,
    subtotal: Number(row.subtotal),
    delivery_fee: Number(row.delivery_fee),
    tax_amount: Number(row.tax_amount),
    offer_discount: Number(row.discount_amount),
    rider_tip: Number(row.rider_tip),
    total_amount: Number(row.total_amount),
    customer_note: row.customer_note,
    cancellation_reason: row.cancellation_reason,
    payment_mode: row.payment_method,
    delivery_address: addressParts.join(", "),
    delivery_latitude: row.delivery_latitude == null ? null : Number(row.delivery_latitude),
    delivery_longitude: row.delivery_longitude == null ? null : Number(row.delivery_longitude),
    parcel_pickup_address: row.parcel_pickup_address,
    parcel_drop_address: row.parcel_drop_address,
    parcel_description: row.parcel_description,
    delivery_otp: "----",
    placed_at: row.placed_at,
    created_at_ms: createdAtMs,
    delivery_deadline_ms: createdAtMs == null ? null : createdAtMs + 25 * 60 * 1000,
    accepted_at: row.accepted_at,
    dispatched_at: row.dispatched_at,
    delivered_at: row.delivered_at,
    cancelled_at: row.cancelled_at,
    assigned_rider: row.rider_name,
    assigned_rider_id: row.rider_id,
    assignment_id: row.assignment_id,
    assignment_status: row.assignment_status,
    rider_phone: row.rider_phone,
    items,
    fulfillments: Array.isArray(row.fulfillments) ? row.fulfillments : []
  };
}

async function listCustomerOrders(req, res) {
  const bucket = String(req.query.bucket || "active").toLowerCase();
  if (!["active", "past", "all"].includes(bucket)) {
    return res.status(400).json({ success: false, message: "bucket must be active, past, or all.", data: null });
  }
  try {
    let statusSql = "";
    const values = [req.user.id];
    if (bucket === "active") statusSql = "AND o.status = ANY($2::text[])", values.push(ACTIVE_STATUSES);
    if (bucket === "past") statusSql = "AND o.status = ANY($2::text[])", values.push(PAST_STATUSES);
    const result = await db.query(
      `${ORDER_PROJECTION}
       WHERE o.customer_user_id = $1 ${statusSql}
       ORDER BY o.placed_at DESC
       LIMIT 100`,
      values
    );
    return res.json({ success: true, data: result.rows.map(presentOrder) });
  } catch (error) {
    console.error("Customer order listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve orders.", data: null });
  }
}

async function getCustomerOrder(req, res) {
  const { orderId } = req.params;
  if (!UUID_PATTERN.test(orderId)) return res.status(400).json({ success: false, message: "Invalid order id.", data: null });
  try {
    const result = await db.query(
      `${ORDER_PROJECTION}
       WHERE o.id = $1 AND o.customer_user_id = $2`,
      [orderId, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Order not found.", data: null });
    return res.json({ success: true, data: presentOrder(result.rows[0]) });
  } catch (error) {
    console.error("Customer order retrieval failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve order.", data: null });
  }
}

function buildOrderNumber() {
  return `MSZ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

async function createCustomerOrder(req, res) {
  let client;
  try {
    const orderType = String(req.body?.order_type || "GOODS").toUpperCase();
    if (!["GOODS", "PARCEL"].includes(orderType)) throw httpError(400, "Unsupported order type.");
    let address = normalizeAddress(req.body?.address);
    const paymentMethod = normalizePaymentMethod(req.body?.payment_method);
    const note = req.body?.customer_note == null ? null : String(req.body.customer_note).trim();
    if (note && note.length > 2000) throw httpError(400, "Customer note is too long.");

    const riderTip = orderType === "PARCEL" ? 0 : Number(req.body?.rider_tip || 0);
    if (!Number.isFinite(riderTip) || riderTip < 0 || riderTip > 10000) throw httpError(400, "Invalid rider tip.");

    let lines = [];
    let cartId = null;
    let subtotal;
    let deliveryFee;
    let taxAmount;
    let discountAmount;
    let finalTip = riderTip;
    let parcel = null;

    if (orderType === "PARCEL") {
      const pickupAddress = typeof req.body?.parcel?.pickup_address === "string" ? req.body.parcel.pickup_address.trim() : "";
      const dropAddress = typeof req.body?.parcel?.drop_address === "string" ? req.body.parcel.drop_address.trim() : "";
      const description = typeof req.body?.parcel?.description === "string" ? req.body.parcel.description.trim() : "";
      const pickupCoordinates = normalizeParcelCoordinates(req.body?.parcel, "pickup");
      const dropCoordinates = normalizeParcelCoordinates(req.body?.parcel, "drop");
      if (!pickupAddress || !dropAddress || !description
          || pickupAddress.length > 1000 || dropAddress.length > 1000 || description.length > 1000) {
        throw httpError(400, "Parcel pickup, drop-off, and description are required.");
      }
      if (dropCoordinates) {
        address = { ...address, latitude: dropCoordinates.latitude, longitude: dropCoordinates.longitude };
      }
      const pickupSnapshot = pickupCoordinates
        ? `${pickupAddress} (GPS: ${pickupCoordinates.latitude.toFixed(6)}, ${pickupCoordinates.longitude.toFixed(6)})`
        : pickupAddress;
      parcel = { pickupAddress: pickupSnapshot, dropAddress, description };
      subtotal = 50;
      deliveryFee = 0;
      taxAmount = 0;
      discountAmount = 0;
      finalTip = 0;
    }

    client = await db.connect();
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.change_source', $2, true)", [req.user.id, "CUSTOMER_API"]);

    let resolvedLines = [];
    if (orderType === "GOODS") {
      const databaseCart = await client.query(
        `SELECT c.id AS cart_id, p.id AS product_id, ci.quantity,
                pv.id AS variant_id, pv.unit_quantity AS selected_weight
         FROM carts c
         JOIN cart_items ci ON ci.cart_id = c.id
         JOIN product_variants pv ON pv.id = ci.variant_id
         JOIN products p ON p.id = pv.product_id
         WHERE c.user_id = $1 AND c.status = 'ACTIVE'
         ORDER BY ci.added_at ASC
         FOR UPDATE OF c`,
        [req.user.id]
      );
      if (databaseCart.rows.length) {
        cartId = databaseCart.rows[0].cart_id;
        lines = databaseCart.rows.map(row => ({
          productId: row.product_id,
          variantId: row.variant_id,
          quantity: Number(row.quantity),
          selectedWeight: Number(row.selected_weight)
        }));
      } else {
        lines = normalizeCartLines(req.body?.items);
      }
      if (!lines.length) throw httpError(400, "Your cart is empty.");

      for (const line of lines) {
        const result = await client.query(
          `SELECT p.id AS product_id, p.name AS product_name,
                  pv.id AS variant_id, pv.name AS variant_name, pv.sku,
                  pv.unit_label, pv.unit_quantity, pv.price,
                  s.id AS shop_id, s.name AS shop_name,
                  concat_ws(', ', s.address_line1, s.locality, s.city, s.state, s.postal_code) AS pickup_address,
                  COALESCE(i.quantity_on_hand, 0) AS quantity_on_hand,
                  COALESCE(i.quantity_reserved, 0) AS quantity_reserved
           FROM products p
           JOIN shops s ON s.id = p.shop_id
           JOIN product_variants pv ON pv.product_id = p.id
           LEFT JOIN inventory i ON i.variant_id = pv.id
           WHERE p.id = $1 AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
             AND s.status = 'ACTIVE' AND s.deleted_at IS NULL
             AND pv.is_active = true AND pv.deleted_at IS NULL
             AND ($2::uuid IS NULL OR pv.id = $2)
             AND ($3::numeric IS NULL OR pv.unit_quantity = $3)
             AND ($2::uuid IS NOT NULL OR $3::numeric IS NOT NULL OR pv.is_default = true)
           ORDER BY pv.is_default DESC
           LIMIT 1
           FOR UPDATE OF p, pv`,
          [line.productId, line.variantId, line.selectedWeight]
        );
        const variant = result.rows[0];
        if (!variant) throw httpError(409, "A cart item is no longer available at its selected shop or variant.");
        const available = Number(variant.quantity_on_hand) - Number(variant.quantity_reserved);
        if (available < line.quantity) throw httpError(409, `${variant.product_name} does not have enough available stock.`);
        const reservation = await client.query(
          `UPDATE inventory
           SET quantity_reserved = quantity_reserved + $2, updated_at = now()
           WHERE variant_id = $1 AND quantity_on_hand - quantity_reserved >= $2
           RETURNING variant_id`,
          [variant.variant_id, line.quantity]
        );
        if (!reservation.rows[0]) throw httpError(409, `${variant.product_name} does not have enough available stock.`);
        resolvedLines.push({ ...variant, quantity: line.quantity });
      }

      subtotal = roundMoney(resolvedLines.reduce((sum, line) => sum + Number(line.price) * line.quantity, 0));
      if (subtotal <= 0) throw httpError(400, "Your cart has no valid items.");
      deliveryFee = subtotal >= 199 ? 0 : 25;
      taxAmount = 4;
      discountAmount = subtotal >= 499 ? 50 : 0;
    }

    const totalAmount = roundMoney(subtotal + deliveryFee + taxAmount + finalTip - discountAmount);
    const orderResult = await client.query(
      `INSERT INTO orders
         (order_number, customer_user_id, status, order_type, currency, subtotal,
          delivery_fee, tax_amount, discount_amount, rider_tip, total_amount, customer_note)
       VALUES ($1, $2, 'PLACED', $3, 'INR', $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, order_number, status, order_type, subtotal, delivery_fee, tax_amount,
                 discount_amount, rider_tip, total_amount, placed_at`,
      [buildOrderNumber(), req.user.id, orderType, subtotal, deliveryFee, taxAmount, discountAmount, finalTip, totalAmount, note]
    );
    const order = orderResult.rows[0];

    await client.query(
      `INSERT INTO order_addresses
         (order_id, recipient_name, recipient_phone_e164, address_line1, address_line2,
          landmark, locality, city, state, postal_code, country_code, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [order.id, address.recipientName, address.phone, address.addressLine1, address.addressLine2,
        address.landmark, address.locality, address.city, address.state, address.postalCode,
        address.countryCode, address.latitude, address.longitude]
    );

    if (orderType === "PARCEL") {
      await client.query(
        `INSERT INTO parcel_details (order_id, parcel_pickup_address, parcel_drop_address, parcel_description)
         VALUES ($1, $2, $3, $4)`,
        [order.id, parcel.pickupAddress, parcel.dropAddress, parcel.description]
      );
    } else {
      const fulfillmentIds = new Map();
      for (const line of resolvedLines) {
        if (!fulfillmentIds.has(line.shop_id)) {
          const fulfillmentResult = await client.query(
            `INSERT INTO order_fulfillments
               (order_id, shop_id, shop_name_snapshot, pickup_address_snapshot, status)
             VALUES ($1, $2, $3, $4, 'PLACED')
             RETURNING id`,
            [order.id, line.shop_id, line.shop_name, line.pickup_address]
          );
          const fulfillmentId = fulfillmentResult.rows[0].id;
          fulfillmentIds.set(line.shop_id, fulfillmentId);
          await client.query(
            `INSERT INTO fulfillment_status_history (fulfillment_id, from_status, to_status, changed_by_user_id, reason)
             VALUES ($1, NULL, 'PLACED', $2, 'Order placed')`,
            [fulfillmentId, req.user.id]
          );
        }
        const fulfillmentId = fulfillmentIds.get(line.shop_id);
        const lineTotal = roundMoney(line.quantity * Number(line.price));
        await client.query(
          `INSERT INTO order_items
             (order_id, fulfillment_id, product_id, variant_id, product_name_snapshot,
              variant_name_snapshot, sku_snapshot, unit_snapshot, quantity, unit_price, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [order.id, fulfillmentId, line.product_id, line.variant_id, line.product_name,
            line.variant_name, line.sku, line.unit_label, line.quantity, line.price, lineTotal]
        );
      }
      if (cartId) {
        await client.query("UPDATE carts SET status = 'CONVERTED', updated_at = now() WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE'", [cartId, req.user.id]);
      }
    }

    await client.query(
      `INSERT INTO payments (order_id, method, provider, status, amount, currency)
       VALUES ($1, $2, 'MANUAL', 'PENDING', $3, 'INR')`,
      [order.id, paymentMethod, totalAmount]
    );
    await client.query("COMMIT");
    return res.status(201).json({
      success: true,
      data: {
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        order_type: order.order_type,
        subtotal: Number(order.subtotal),
        delivery_fee: Number(order.delivery_fee),
        tax_amount: Number(order.tax_amount),
        offer_discount: Number(order.discount_amount),
        rider_tip: Number(order.rider_tip),
        total_amount: Number(order.total_amount),
        payment_mode: paymentMethod,
        items: resolvedLines.map(line => ({
          product_id: line.product_id,
          variant_id: line.variant_id,
          name: line.product_name,
          variant_name: line.variant_name,
          unit: line.unit_label,
          quantity: line.quantity,
          price: Number(line.price),
          pickup_source_name: line.shop_name,
          pickup_source_address: line.pickup_address
        }))
      }
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.status) return res.status(error.status).json({ success: false, message: error.message, data: null });
    if (error.code === "23505") return res.status(409).json({ success: false, message: "An order with these details already exists.", data: null });
    if (error.code === "23514" || error.code === "22P02" || error.code === "23503") {
      return res.status(400).json({ success: false, message: "Order details are invalid or unavailable.", data: null });
    }
    console.error("Customer order creation failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to place order.", data: null });
  } finally {
    client?.release();
  }
}

async function cancelCustomerOrder(req, res) {
  const { orderId } = req.params;
  if (!UUID_PATTERN.test(orderId)) return res.status(400).json({ success: false, message: "Invalid order id.", data: null });
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "Cancelled by customer";
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const orderResult = await client.query(
      "SELECT id, status FROM orders WHERE id = $1 AND customer_user_id = $2 FOR UPDATE",
      [orderId, req.user.id]
    );
    const order = orderResult.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Order not found.", data: null });
    }
    if (!["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "PICKING_UP", "DELIVERY_FAILED"].includes(order.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "This order can no longer be cancelled.", data: null });
    }

    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.change_source', $2, true), set_config('app.change_reason', $3, true)", [req.user.id, "CUSTOMER_API", reason]);
    await client.query(
      `UPDATE orders
       SET status = 'CANCELLED', cancellation_reason = $3, cancelled_by_user_id = $2, cancelled_at = now(), updated_at = now()
       WHERE id = $1 AND customer_user_id = $2`,
      [orderId, req.user.id, reason]
    );
    const fulfillments = await client.query(
      `SELECT id, status FROM order_fulfillments
       WHERE order_id = $1 AND status NOT IN ('CANCELLED', 'REJECTED')
       FOR UPDATE`,
      [orderId]
    );
    for (const fulfillment of fulfillments.rows) {
      await client.query("UPDATE order_fulfillments SET status = 'CANCELLED', updated_at = now() WHERE id = $1", [fulfillment.id]);
      await client.query(
        `INSERT INTO fulfillment_status_history (fulfillment_id, from_status, to_status, changed_by_user_id, reason)
         VALUES ($1, $2, 'CANCELLED', $3, $4)`,
        [fulfillment.id, fulfillment.status, req.user.id, reason]
      );
    }
    const assignments = await client.query(
      `SELECT da.id, da.status, r.user_id
       FROM delivery_assignments da
       JOIN riders r ON r.id = da.rider_id
       WHERE da.order_id = $1
         AND da.status IN ('OFFERED', 'ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY')
       FOR UPDATE OF da`,
      [orderId]
    );
    for (const assignment of assignments.rows) {
      await client.query(
        `UPDATE delivery_assignments
         SET status = 'CANCELLED', updated_at = now()
         WHERE id = $1`,
        [assignment.id]
      );
      await client.query(
        `INSERT INTO delivery_tracking (assignment_id, event_type, actor_user_id, details)
         VALUES ($1, 'CANCELLED', $2, $3::jsonb)`,
        [assignment.id, req.user.id, JSON.stringify({ reason, source: "CUSTOMER_API" })]
      );
      await client.query(
        `INSERT INTO notifications (user_id, channel, status, title, body, payload)
         VALUES ($1, 'IN_APP', 'PENDING', 'Delivery cancelled', $2, $3::jsonb)`,
        [assignment.user_id, `Order ${orderId} was cancelled by the customer.`, JSON.stringify({ event: "delivery.assignment.cancelled", order_id: orderId, assignment_id: assignment.id })]
      );
    }
    await client.query(
      `WITH item_reservations AS (
         SELECT variant_id, sum(quantity) AS quantity
         FROM order_items
         WHERE order_id = $1 AND variant_id IS NOT NULL
         GROUP BY variant_id
       )
       UPDATE inventory i
       SET quantity_reserved = GREATEST(0, i.quantity_reserved - item_reservations.quantity), updated_at = now()
       FROM item_reservations
       WHERE i.variant_id = item_reservations.variant_id`,
      [orderId]
    );
    await client.query(
      `UPDATE payments SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
       WHERE order_id = $1 AND status IN ('PENDING', 'INITIATED', 'FAILED')`,
      [orderId]
    );
    await client.query("COMMIT");
    return res.json({ success: true, data: { id: orderId, status: "CANCELLED" } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23514") return res.status(409).json({ success: false, message: "Order cancellation violates a status rule.", data: null });
    console.error("Customer order cancellation failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to cancel order.", data: null });
  } finally {
    client?.release();
  }
}

module.exports = {
  ORDER_PROJECTION,
  ACTIVE_STATUSES,
  PAST_STATUSES,
  presentOrder,
  listCustomerOrders,
  getCustomerOrder,
  createCustomerOrder,
  cancelCustomerOrder
};
