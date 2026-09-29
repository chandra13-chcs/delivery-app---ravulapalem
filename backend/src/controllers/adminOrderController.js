"use strict";

const db = require("../config/db");
const { ORDER_PROJECTION, ACTIVE_STATUSES, PAST_STATUSES, presentOrder } = require("./orderController");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function listAdminOrders(req, res) {
  const bucket = String(req.query.bucket || "active").toLowerCase();
  if (!["active", "past", "all"].includes(bucket)) {
    return res.status(400).json({ success: false, message: "bucket must be active, past, or all.", data: null });
  }

  const values = [];
  let statusFilter = "";
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
    return res.json({ success: true, data: result.rows.map(presentOrder) });
  } catch (error) {
    console.error("Admin order listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve orders.", data: null });
  }
}

async function getAdminOrder(req, res) {
  const { orderId } = req.params;
  if (!UUID_PATTERN.test(orderId)) return res.status(400).json({ success: false, message: "Invalid order id.", data: null });
  try {
    const result = await db.query(`${ORDER_PROJECTION} WHERE o.id = $1`, [orderId]);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Order not found.", data: null });
    return res.json({ success: true, data: presentOrder(result.rows[0]) });
  } catch (error) {
    console.error("Admin order retrieval failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve order.", data: null });
  }
}

module.exports = { listAdminOrders, getAdminOrder };
