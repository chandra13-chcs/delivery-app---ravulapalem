"use strict";

const db = require("../config/db");
const { ACTIVE_STATUSES, PAST_STATUSES } = require("./orderController");
const { createUserNotification } = require("../services/notificationService");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PARTNER_ORDER_PROJECTION = `
  SELECT o.id, o.order_number, o.customer_user_id, o.status AS order_status,
         o.order_type, o.currency, o.subtotal, o.delivery_fee, o.tax_amount,
         o.discount_amount, o.rider_tip, o.total_amount, o.customer_note,
         o.placed_at, o.accepted_at, o.dispatched_at, o.delivered_at,
         u.display_name AS customer_name, u.phone_e164 AS customer_phone,
         oa.recipient_name, oa.recipient_phone_e164, oa.address_line1,
         oa.address_line2, oa.landmark, oa.locality, oa.city, oa.state,
         oa.postal_code, f.id AS fulfillment_id, f.shop_id,
         f.shop_name_snapshot, f.pickup_address_snapshot, f.status AS fulfillment_status,
         COALESCE(item_data.items, '[]'::jsonb) AS items
  FROM order_fulfillments f
  JOIN orders o ON o.id = f.order_id
  JOIN shops s ON s.id = f.shop_id
  JOIN users u ON u.id = o.customer_user_id
  LEFT JOIN order_addresses oa ON oa.order_id = o.id
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
        'line_total', oi.line_total,
        'pickup_source_name', f.shop_name_snapshot,
        'pickup_source_address', f.pickup_address_snapshot
      ) ORDER BY oi.created_at ASC, oi.id ASC
    ) AS items
    FROM order_items oi
    WHERE oi.fulfillment_id = f.id AND oi.order_id = o.id
  ) item_data ON true`;

function invalidId(res) {
  return res.status(400).json({ success: false, message: "Invalid order or shop id.", data: null });
}

function presentPartnerOrder(row) {
  const address = [row.address_line1, row.address_line2, row.landmark, row.locality, row.city, row.state, row.postal_code]
    .filter(Boolean).join(", ");
  const placedAt = row.placed_at ? new Date(row.placed_at) : null;
  return {
    id: row.id,
    order_number: row.order_number,
    fulfillment_id: row.fulfillment_id,
    shop_id: row.shop_id,
    status: row.fulfillment_status,
    order_status: row.order_status,
    order_type: row.order_type,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    delivery_address: address,
    shop_name: row.shop_name_snapshot,
    pickup_address: row.pickup_address_snapshot,
    subtotal: Number(row.subtotal),
    delivery_fee: Number(row.delivery_fee),
    total_amount: Number(row.total_amount),
    placed_at: row.placed_at,
    created_at_ms: placedAt && Number.isFinite(placedAt.getTime()) ? placedAt.getTime() : null,
    items: Array.isArray(row.items) ? row.items : []
  };
}

async function listPartnerOrders(req, res) {
  const bucket = String(req.query.bucket || "active").toLowerCase();
  if (!["active", "past", "all"].includes(bucket)) {
    return res.status(400).json({ success: false, message: "bucket must be active, past, or all.", data: null });
  }
  const shopId = typeof req.query.shop_id === "string" ? req.query.shop_id : null;
  if (shopId && (!UUID_PATTERN.test(shopId))) return invalidId(res);
  if (shopId && !req.shopIds?.includes(shopId)) {
    const allowedShop = await db.query(
      "SELECT 1 FROM shops WHERE id = $1 AND partner_id = ANY($2::uuid[]) AND deleted_at IS NULL",
      [shopId, req.partnerIds]
    ).catch(error => {
      console.error("Partner order shop authorization failed:", error.message);
      return null;
    });
    if (!allowedShop?.rows?.[0]) return res.status(404).json({ success: false, message: "Shop not found.", data: null });
  }

  const values = [req.partnerIds];
  let filters = "s.partner_id = ANY($1::uuid[]) AND s.deleted_at IS NULL";
  if (shopId) {
    values.push(shopId);
    filters += ` AND f.shop_id = $${values.length}`;
  }
  if (bucket === "active") {
    values.push(ACTIVE_STATUSES);
    filters += ` AND o.status = ANY($${values.length}::text[])`;
  } else if (bucket === "past") {
    values.push(PAST_STATUSES);
    filters += ` AND o.status = ANY($${values.length}::text[])`;
  }

  try {
    const result = await db.query(
      `${PARTNER_ORDER_PROJECTION}
       WHERE ${filters}
       ORDER BY o.placed_at DESC
       LIMIT 100`,
      values
    );
    return res.json({ success: true, data: result.rows.map(presentPartnerOrder) });
  } catch (error) {
    console.error("Partner order listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve partner orders.", data: null });
  }
}

async function getPartnerOrder(req, res) {
  const { orderId } = req.params;
  if (!UUID_PATTERN.test(orderId)) return invalidId(res);
  const shopId = typeof req.query.shop_id === "string" ? req.query.shop_id : null;
  if (shopId && !UUID_PATTERN.test(shopId)) return invalidId(res);

  try {
    const values = [orderId, req.partnerIds];
    let shopFilter = "";
    if (shopId) {
      values.push(shopId);
      shopFilter = ` AND f.shop_id = $${values.length}`;
    }
    const result = await db.query(
      `${PARTNER_ORDER_PROJECTION}
       WHERE o.id = $1 AND s.partner_id = ANY($2::uuid[])
         AND s.deleted_at IS NULL ${shopFilter}
       ORDER BY f.created_at ASC`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Order not found.", data: null });
    return res.json({ success: true, data: result.rows.map(presentPartnerOrder) });
  } catch (error) {
    console.error("Partner order retrieval failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve partner order.", data: null });
  }
}

async function updatePartnerOrderStatus(req, res) {
  const { orderId, shopId } = req.params;
  if (!UUID_PATTERN.test(orderId) || !UUID_PATTERN.test(shopId)) return invalidId(res);
  const requestedStatus = String(req.body?.status || "").toUpperCase();
  const nextStatus = requestedStatus === "PACKED" ? "READY_FOR_PICKUP" : requestedStatus;
  const allowedTransitions = {
    PLACED: ["ACCEPTED"],
    ACCEPTED: ["PREPARING"],
    PREPARING: ["READY_FOR_PICKUP"]
  };
  if (!["ACCEPTED", "PREPARING", "READY_FOR_PICKUP"].includes(nextStatus)) {
    return res.status(400).json({ success: false, message: "Unsupported fulfillment status.", data: null });
  }

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const fulfillmentResult = await client.query(
            `SELECT f.id, f.status AS fulfillment_status, f.order_id,
              o.status AS order_status, o.customer_user_id, o.order_number
       FROM order_fulfillments f
       JOIN orders o ON o.id = f.order_id
       JOIN shops s ON s.id = f.shop_id
       WHERE f.order_id = $1 AND f.shop_id = $2
         AND s.partner_id = ANY($3::uuid[]) AND s.deleted_at IS NULL
       FOR UPDATE OF f, o`,
      [orderId, shopId, req.partnerIds]
    );
    const fulfillment = fulfillmentResult.rows[0];
    if (!fulfillment) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Order not found.", data: null });
    }
    if (!allowedTransitions[fulfillment.fulfillment_status]?.includes(nextStatus)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: `Invalid fulfillment status transition: ${fulfillment.fulfillment_status} to ${nextStatus}.`,
        data: null
      });
    }

    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.change_source', $2, true)", [req.user.id, "PARTNER_API"]);
    await client.query(
      "UPDATE order_fulfillments SET status = $2, accepted_at = CASE WHEN $2 = 'ACCEPTED' THEN now() ELSE accepted_at END, ready_at = CASE WHEN $2 = 'READY_FOR_PICKUP' THEN now() ELSE ready_at END, updated_at = now() WHERE id = $1",
      [fulfillment.id, nextStatus]
    );
    await client.query(
      `INSERT INTO fulfillment_status_history (fulfillment_id, from_status, to_status, changed_by_user_id)
       VALUES ($1, $2, $3, $4)`,
      [fulfillment.id, fulfillment.fulfillment_status, nextStatus, req.user.id]
    );

    const aggregate = await client.query(
      `SELECT bool_and(status IN ('ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKING_UP', 'CANCELLED', 'REJECTED')) AS all_accepted,
              bool_and(status IN ('PREPARING', 'READY_FOR_PICKUP', 'PICKING_UP', 'CANCELLED', 'REJECTED')) AS all_preparing,
              bool_and(status IN ('READY_FOR_PICKUP', 'PICKING_UP', 'CANCELLED', 'REJECTED')) AS all_ready
       FROM order_fulfillments
       WHERE order_id = $1`,
      [orderId]
    );
    const state = aggregate.rows[0];
    let orderStatus = null;
    if (fulfillment.order_status === "PLACED" && state.all_accepted) orderStatus = "ACCEPTED";
    else if (fulfillment.order_status === "ACCEPTED" && state.all_preparing) orderStatus = "PREPARING";
    else if (fulfillment.order_status === "PREPARING" && state.all_ready) orderStatus = "READY_FOR_PICKUP";
    if (orderStatus) {
      await client.query(
        `UPDATE orders
         SET status = $2,
             accepted_at = CASE WHEN $2 = 'ACCEPTED' THEN now() ELSE accepted_at END,
             updated_at = now()
         WHERE id = $1`,
        [orderId, orderStatus]
      );
      await createUserNotification(
        client,
        fulfillment.customer_user_id,
        `Order ${orderStatus.toLowerCase().replaceAll("_", " ")}`,
        `Order ${fulfillment.order_number} is now ${orderStatus.toLowerCase().replaceAll("_", " ")}.`,
        { event: `order.${orderStatus.toLowerCase()}`, order_id: orderId, recipient_type: "CUSTOMER" }
      );
    }

    await client.query("COMMIT");
    return res.json({ success: true, data: { order_id: orderId, shop_id: shopId, fulfillment_status: nextStatus, order_status: orderStatus || fulfillment.order_status } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23514") return res.status(409).json({ success: false, message: "The order status transition is not allowed.", data: null });
    console.error("Partner order status update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update partner order.", data: null });
  } finally {
    client?.release();
  }
}

module.exports = { listPartnerOrders, getPartnerOrder, updatePartnerOrderStatus };
