"use strict";

const db = require("../config/db");
const { normalizePaymentStatus } = require("../services/paymentService");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respondError(res, status, message) {
  return res.status(status).json({ success: false, message, data: null });
}

function presentPayment(row) {
  return {
    id: row.id,
    order_id: row.order_id,
    status: normalizePaymentStatus(row.status),
    method: row.method,
    amount: Number(row.amount),
    currency: row.currency,
    provider_name: row.provider_name,
    provider_order_reference: row.provider_order_reference,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function getOrderPaymentStatus(req, res) {
  const { orderId } = req.params;
  if (!UUID_PATTERN.test(orderId)) return respondError(res, 400, "Invalid order id.");
  try {
    const result = await db.query(
      `SELECT p.id, p.order_id, p.status, p.method, p.amount, p.currency,
              p.provider_name, p.provider_order_reference, p.created_at, p.updated_at
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE o.id = $1 AND o.customer_user_id = $2
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 1`,
      [orderId, req.user.id]
    );
    if (!result.rows[0]) return respondError(res, 404, "Payment not found.");
    return res.json({ success: true, data: presentPayment(result.rows[0]) });
  } catch (error) {
    console.error("Payment status retrieval failed:", error.message);
    return respondError(res, 500, "Unable to retrieve payment status.");
  }
}

async function initializeOrderPayment(req, res) {
  const { orderId } = req.params;
  if (!UUID_PATTERN.test(orderId)) return respondError(res, 400, "Invalid order id.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const orderResult = await client.query(
      `SELECT id, status, total_amount, currency
       FROM orders
       WHERE id = $1 AND customer_user_id = $2
       FOR UPDATE`,
      [orderId, req.user.id]
    );
    const order = orderResult.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Order not found.");
    }
    if (["CANCELLED", "REJECTED"].includes(order.status)) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Cancelled or rejected orders cannot be paid.");
    }
    const amount = Number(order.total_amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "This order does not have a payable amount.");
    }

    const paymentsResult = await client.query(
      `SELECT id, method, status, amount, currency, provider_name, provider_order_reference,
              created_at, updated_at
       FROM payments
       WHERE order_id = $1
       ORDER BY created_at DESC, id DESC
       FOR UPDATE`,
      [order.id]
    );
    let payment = paymentsResult.rows[0];
    if (paymentsResult.rows.some(row => row.status === "SUCCESSFUL")) {
      await client.query("COMMIT");
      const successfulPayment = paymentsResult.rows.find(row => row.status === "SUCCESSFUL");
      return res.json({ success: true, data: { ...presentPayment(successfulPayment), provider_configured: false } });
    }
    if (payment?.method === "COD") {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Cash on delivery orders cannot be initialized as online payments.");
    }
    if (payment && (!Number.isFinite(Number(payment.amount)) || Number(payment.amount) !== amount)) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Payment amount does not match the order amount.");
    }
    if (payment?.status === "CANCELLED") {
      await client.query("ROLLBACK");
      return respondError(res, 409, "This payment attempt has been cancelled.");
    }
    if (!payment) {
      const inserted = await client.query(
        `INSERT INTO payments (order_id, method, provider, status, amount, currency)
         VALUES ($1, 'UPI', 'GATEWAY', 'PENDING', $2, $3)
         RETURNING id, method, status, amount, currency, provider_name,
                   provider_order_reference, created_at, updated_at`,
        [order.id, amount, order.currency]
      );
      payment = inserted.rows[0];
    }
    if (payment.status === "PENDING" || payment.status === "FAILED") {
      const updated = await client.query(
        `UPDATE payments
         SET method = 'UPI', provider = 'GATEWAY', status = 'INITIATED',
             provider_name = NULL, provider_order_reference = NULL,
             initiated_at = now(), failed_at = NULL, updated_at = now()
         WHERE id = $1
         RETURNING id, method, status, amount, currency, provider_name,
                   provider_order_reference, created_at, updated_at`,
        [payment.id]
      );
      payment = updated.rows[0];
      await client.query(
        `INSERT INTO payment_transactions (payment_id, transaction_type, status, amount)
         VALUES ($1, 'INITIATE', 'PENDING', $2)`,
        [payment.id, amount]
      );
    } else if (payment.status !== "INITIATED") {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Payment cannot be initialized from its current status.");
    }

    await client.query("COMMIT");
    return res.status(200).json({
      success: true,
      data: { ...presentPayment(payment), provider_configured: false }
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23514") return respondError(res, 409, "Payment status transition is not allowed.");
    console.error("Payment initialization failed:", error.message);
    return respondError(res, 500, "Unable to initialize payment.");
  } finally {
    client?.release();
  }
}

module.exports = { getOrderPaymentStatus, initializeOrderPayment };
