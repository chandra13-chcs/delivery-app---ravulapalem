"use strict";

const db = require("../config/db");
const { createUserNotification } = require("./notificationService");

const PROVIDER_EVENT_STATUSES = new Set(["SUCCESS", "FAILED", "CANCELLED", "REFUNDED"]);

function normalizePaymentStatus(status) {
  return status === "SUCCESSFUL" ? "SUCCESS" : status;
}

function normalizeReference(value, name) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200) {
    throw new TypeError(`${name} is invalid.`);
  }
  return value.trim();
}

function moneyEquals(left, right) {
  return Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
}

async function attachProviderOrderReference(paymentId, providerName, providerOrderReference) {
  const reference = normalizeReference(providerOrderReference, "Provider order reference");
  const provider = normalizeReference(providerName, "Provider name").toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(provider)) throw new TypeError("Provider name is invalid.");

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
                  `SELECT p.id, p.method, p.status, p.amount, p.provider_name,
                    p.provider_order_reference, o.id AS order_id,
                    o.status AS order_status, o.total_amount
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.id = $1
       FOR UPDATE OF o, p`,
      [paymentId]
    );
    const payment = result.rows[0];
    if (!payment) throw Object.assign(new Error("Payment not found."), { status: 404 });
    if (!["PENDING", "INITIATED"].includes(payment.status)
      || payment.method !== "UPI"
      || ["CANCELLED", "REJECTED"].includes(payment.order_status)
      || !moneyEquals(payment.amount, payment.total_amount)) {
      throw Object.assign(new Error("Payment cannot accept a provider reference."), { status: 409 });
    }
    if (payment.provider_order_reference
      && (payment.provider_order_reference !== reference || payment.provider_name !== provider)) {
      throw Object.assign(new Error("Payment already has a different provider reference."), { status: 409 });
    }
    await client.query(
      `UPDATE payments
       SET provider = 'GATEWAY', provider_name = $2,
           provider_order_reference = $3, updated_at = now()
       WHERE id = $1`,
      [paymentId, provider, reference]
    );
    await client.query("COMMIT");
    return { payment_id: paymentId, provider_name: provider, provider_order_reference: reference };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") throw Object.assign(new Error("Provider reference is already in use."), { status: 409 });
    throw error;
  } finally {
    client.release();
  }
}

async function recordVerifiedProviderEvent(event) {
  if (!event || typeof event !== "object" || !PROVIDER_EVENT_STATUSES.has(event.status)) {
    throw new TypeError("A verified provider event with a supported status is required.");
  }
  const provider = normalizeReference(event.providerName, "Provider name").toUpperCase();
  const providerOrderReference = normalizeReference(event.providerOrderReference, "Provider order reference");
  const providerTransactionReference = event.providerTransactionReference == null
    ? null
    : normalizeReference(event.providerTransactionReference, "Provider transaction reference");
  const providerRefundReference = event.providerRefundReference == null
    ? null
    : normalizeReference(event.providerRefundReference, "Provider refund reference");
  if (!/^[A-Z0-9_-]{2,40}$/.test(provider)) throw new TypeError("Provider name is invalid.");

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT p.id, p.order_id, p.status AS payment_status, p.amount, p.currency,
              o.customer_user_id, o.status AS order_status, o.total_amount,
              o.currency AS order_currency
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.provider_name = $1 AND p.provider_order_reference = $2
       FOR UPDATE OF o, p`,
      [provider, providerOrderReference]
    );
    const payment = result.rows[0];
    if (!payment) throw Object.assign(new Error("Payment reference not found."), { status: 404 });
    if (event.amount == null || !moneyEquals(event.amount, payment.amount)
      || !moneyEquals(payment.amount, payment.total_amount)
      || payment.currency !== payment.order_currency
      || (event.currency != null && String(event.currency).toUpperCase() !== payment.currency)) {
      throw Object.assign(new Error("Provider amount does not match the order amount."), { status: 409 });
    }

    const targetStatus = event.status === "SUCCESS" ? "SUCCESSFUL" : event.status;
    if (targetStatus === "SUCCESSFUL" && ["CANCELLED", "REJECTED"].includes(payment.order_status)) {
      throw Object.assign(new Error("Cancelled or rejected orders cannot be paid."), { status: 409 });
    }
    if (targetStatus === "SUCCESSFUL") {
      const duplicate = await client.query(
        `SELECT id FROM payments
         WHERE order_id = $1 AND status = 'SUCCESSFUL' AND id <> $2
         LIMIT 1 FOR UPDATE`,
        [payment.order_id, payment.id]
      );
      if (duplicate.rows[0]) throw Object.assign(new Error("Order already has a successful payment."), { status: 409 });
    }

    if (payment.payment_status === targetStatus) {
      await client.query("COMMIT");
      return { payment_id: payment.id, order_id: payment.order_id, status: normalizePaymentStatus(targetStatus) };
    }
    if (payment.payment_status === "SUCCESSFUL" && targetStatus !== "REFUNDED") {
      throw Object.assign(new Error("Successful payments can only transition to refunded."), { status: 409 });
    }
    if (targetStatus === "REFUNDED") {
      if (payment.payment_status !== "SUCCESSFUL" || !providerRefundReference) {
        throw Object.assign(new Error("A successful payment and provider refund reference are required."), { status: 409 });
      }
      await client.query(
        `INSERT INTO refunds (payment_id, amount, status, provider_refund_reference, completed_at)
         VALUES ($1, $2, 'SUCCESSFUL', $3, now())`,
        [payment.id, payment.amount, providerRefundReference]
      );
    } else {
      const transition = {
        SUCCESS: { transactionType: "CAPTURE", transactionStatus: "SUCCESSFUL" },
        FAILED: { transactionType: "FAILURE", transactionStatus: "FAILED" },
        CANCELLED: { transactionType: "CANCEL", transactionStatus: "FAILED" }
      }[event.status];
      if (!transition || payment.payment_status !== "INITIATED") {
        throw Object.assign(new Error("Invalid payment status transition."), { status: 409 });
      }
      await client.query(
        `INSERT INTO payment_transactions
           (payment_id, transaction_type, status, amount, provider_transaction_reference)
         VALUES ($1, $2, $3, $4, $5)`,
        [payment.id, transition.transactionType, transition.transactionStatus, payment.amount, providerTransactionReference]
      );
    }

    const updated = await client.query(
      `UPDATE payments
       SET status = $2,
           confirmed_at = CASE WHEN $2 = 'SUCCESSFUL' THEN now() ELSE confirmed_at END,
           failed_at = CASE WHEN $2 = 'FAILED' THEN now() ELSE failed_at END,
           cancelled_at = CASE WHEN $2 = 'CANCELLED' THEN now() ELSE cancelled_at END,
           updated_at = now()
       WHERE id = $1
       RETURNING id, status`,
      [payment.id, targetStatus]
    );
    const titles = {
      SUCCESS: "Payment confirmed",
      FAILED: "Payment failed",
      CANCELLED: "Payment cancelled",
      REFUNDED: "Payment refunded"
    };
    await createUserNotification(
      client,
      payment.customer_user_id,
      titles[event.status],
      `Payment for order ${payment.order_id} is ${normalizePaymentStatus(targetStatus).toLowerCase()}.`,
      { event: `payment.${event.status.toLowerCase()}`, order_id: payment.order_id, payment_id: payment.id, recipient_type: "CUSTOMER" }
    );
    await client.query("COMMIT");
    return { payment_id: updated.rows[0].id, order_id: payment.order_id, status: normalizePaymentStatus(updated.rows[0].status) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") throw Object.assign(new Error("Provider transaction or refund reference already exists."), { status: 409 });
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  attachProviderOrderReference,
  recordVerifiedProviderEvent,
  normalizePaymentStatus
};
