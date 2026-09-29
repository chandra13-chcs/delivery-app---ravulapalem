"use strict";

const db = require("../config/db");

const REPORT_TIME_ZONE = "Asia/Kolkata";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function currentReportDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function timestampAtLocalMidnight(value, daysToAdd = 0) {
  const [year, month, day] = value.split("-").map(Number);
  const utcMilliseconds = Date.UTC(year, month - 1, day + daysToAdd) - (330 * 60 * 1000);
  return new Date(utcMilliseconds).toISOString();
}

function getDateBounds(query) {
  let from = query.from;
  let to = query.to;
  if (Array.isArray(from) || Array.isArray(to)) return { error: "from and to must each be a single YYYY-MM-DD date." };
  if (from == null && to == null) {
    from = currentReportDate();
    to = from;
  } else if (from == null) {
    from = to;
  } else if (to == null) {
    to = from;
  }
  if (!isValidDate(from) || !isValidDate(to)) {
    return { error: "from and to must be valid YYYY-MM-DD dates." };
  }
  if (from > to) return { error: "from must be on or before to." };

  return {
    from,
    to,
    startAt: timestampAtLocalMidnight(from),
    endBefore: timestampAtLocalMidnight(to, 1)
  };
}

function getPagination(query) {
  const rawLimit = query.limit == null ? String(DEFAULT_PAGE_SIZE) : query.limit;
  const rawOffset = query.offset == null ? "0" : query.offset;
  if (Array.isArray(rawLimit) || !/^\d+$/.test(rawLimit)
    || Array.isArray(rawOffset) || !/^\d+$/.test(rawOffset)) {
    return { error: "limit and offset must be non-negative integers." };
  }
  const limit = Number(rawLimit);
  const offset = Number(rawOffset);
  if (limit < 1 || limit > MAX_PAGE_SIZE || !Number.isSafeInteger(offset)) {
    return { error: `limit must be between 1 and ${MAX_PAGE_SIZE}; offset must be a safe integer.` };
  }
  return { limit, offset };
}

function badRequest(res, message) {
  return res.status(400).json({ success: false, message, data: null });
}

function reportError(res, error, operation) {
  console.error(`Admin ${operation} report failed:`, error.message);
  return res.status(500).json({ success: false, message: "Unable to retrieve report data.", data: null });
}

async function getAdminReportSummary(req, res) {
  const bounds = getDateBounds(req.query);
  if (bounds.error) return badRequest(res, bounds.error);

  try {
    const summaryResult = await db.query(
      `SELECT
         COALESCE(SUM(o.total_amount), 0)::numeric(14,2)::text AS gross_order_value,
         COALESCE(SUM(payment_totals.paid_amount), 0)::numeric(14,2)::text AS successful_paid_amount,
         COALESCE(SUM(refund_totals.refunded_amount), 0)::numeric(14,2)::text AS refunds_amount,
         COALESCE(SUM(payment_totals.paid_amount - refund_totals.refunded_amount), 0)::numeric(14,2)::text AS net_amount,
         COUNT(*) FILTER (WHERE o.status = 'DELIVERED')::int AS completed_orders,
         COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled_orders,
         COUNT(*)::int AS total_orders
       FROM orders o
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.status IN ('SUCCESSFUL', 'REFUNDED')), 0) AS paid_amount
         FROM payments p
         WHERE p.order_id = o.id
       ) payment_totals ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'SUCCESSFUL'), 0) AS refunded_amount
         FROM payments p
         JOIN refunds r ON r.payment_id = p.id
         WHERE p.order_id = o.id
       ) refund_totals ON true
       WHERE o.placed_at >= $1::timestamptz
         AND o.placed_at < $2::timestamptz`,
      [bounds.startAt, bounds.endBefore]
    );
    const statusesResult = await db.query(
      `SELECT status, COUNT(*)::int AS order_count
       FROM orders
       WHERE placed_at >= $1::timestamptz AND placed_at < $2::timestamptz
       GROUP BY status
       ORDER BY status`,
      [bounds.startAt, bounds.endBefore]
    );

    return res.json({
      success: true,
      data: {
        range: { from: bounds.from, to: bounds.to, time_zone: REPORT_TIME_ZONE },
        summary: summaryResult.rows[0],
        status_breakdown: statusesResult.rows
      }
    });
  } catch (error) {
    return reportError(res, error, "summary");
  }
}

async function listAdminReportShops(req, res) {
  const bounds = getDateBounds(req.query);
  if (bounds.error) return badRequest(res, bounds.error);
  const pagination = getPagination(req.query);
  if (pagination.error) return badRequest(res, pagination.error);

  try {
    const result = await db.query(
      `WITH filtered_orders AS (
         SELECT id, status
         FROM orders
         WHERE placed_at >= $1::timestamptz AND placed_at < $2::timestamptz
       ), fulfillment_sales AS (
         SELECT oi.fulfillment_id, SUM(oi.line_total) AS sales_amount
         FROM order_items oi
         JOIN filtered_orders o ON o.id = oi.order_id
         WHERE oi.fulfillment_id IS NOT NULL
         GROUP BY oi.fulfillment_id
       ), shop_totals AS (
         SELECT f.shop_id,
                COALESCE(f.shop_name_snapshot, s.name) AS shop_name,
                p.display_name AS partner_name,
                COUNT(DISTINCT o.id)::int AS order_count,
                COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'DELIVERED')::int AS completed_count,
                COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled_count,
                COALESCE(SUM(fs.sales_amount), 0)::numeric(14,2)::text AS sales_amount
         FROM filtered_orders o
         JOIN order_fulfillments f ON f.order_id = o.id
         LEFT JOIN shops s ON s.id = f.shop_id
         LEFT JOIN partners p ON p.id = s.partner_id
         LEFT JOIN fulfillment_sales fs ON fs.fulfillment_id = f.id
         GROUP BY f.shop_id, COALESCE(f.shop_name_snapshot, s.name), p.display_name
       )
       SELECT shop_name,
              COALESCE(partner_name, 'Unknown partner') AS partner_name,
              order_count, completed_count, cancelled_count, sales_amount,
              (SELECT COUNT(*)::int FROM shop_totals) AS total_count
       FROM shop_totals
       ORDER BY sales_amount::numeric DESC, shop_name
       LIMIT $3 OFFSET $4`,
      [bounds.startAt, bounds.endBefore, pagination.limit, pagination.offset]
    );
    let total = Number(result.rows[0]?.total_count || 0);
    if (!result.rows.length) {
      const countResult = await db.query(
        `SELECT COUNT(*)::int AS total
         FROM (
           SELECT f.shop_id, COALESCE(f.shop_name_snapshot, s.name), p.display_name
           FROM orders o
           JOIN order_fulfillments f ON f.order_id = o.id
           LEFT JOIN shops s ON s.id = f.shop_id
           LEFT JOIN partners p ON p.id = s.partner_id
           WHERE o.placed_at >= $1::timestamptz AND o.placed_at < $2::timestamptz
           GROUP BY f.shop_id, COALESCE(f.shop_name_snapshot, s.name), p.display_name
         ) shop_totals`,
        [bounds.startAt, bounds.endBefore]
      );
      total = countResult.rows[0].total;
    }
    return res.json({
      success: true,
      data: result.rows.map(({ total_count: _totalCount, ...row }) => row),
      pagination: { ...pagination, total }
    });
  } catch (error) {
    return reportError(res, error, "shop breakdown");
  }
}

async function listAdminReportOrders(req, res) {
  const bounds = getDateBounds(req.query);
  if (bounds.error) return badRequest(res, bounds.error);
  const pagination = getPagination(req.query);
  if (pagination.error) return badRequest(res, pagination.error);

  try {
    const result = await db.query(
      `SELECT o.order_number, o.placed_at, o.status,
              o.total_amount::numeric(14,2)::text AS gross_order_value,
              payment_totals.paid_amount::numeric(14,2)::text AS successful_paid_amount,
              refund_totals.refunded_amount::numeric(14,2)::text AS refunds_amount,
              shop_totals.shop_names,
              COUNT(*) OVER ()::int AS total_count
       FROM orders o
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.status IN ('SUCCESSFUL', 'REFUNDED')), 0) AS paid_amount
         FROM payments p
         WHERE p.order_id = o.id
       ) payment_totals ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(r.amount) FILTER (WHERE r.status = 'SUCCESSFUL'), 0) AS refunded_amount
         FROM payments p
         JOIN refunds r ON r.payment_id = p.id
         WHERE p.order_id = o.id
       ) refund_totals ON true
       LEFT JOIN LATERAL (
         SELECT string_agg(DISTINCT COALESCE(f.shop_name_snapshot, s.name), ', '
                           ORDER BY COALESCE(f.shop_name_snapshot, s.name)) AS shop_names
         FROM order_fulfillments f
         LEFT JOIN shops s ON s.id = f.shop_id
         WHERE f.order_id = o.id
       ) shop_totals ON true
       WHERE o.placed_at >= $1::timestamptz AND o.placed_at < $2::timestamptz
       ORDER BY o.placed_at DESC, o.id DESC
       LIMIT $3 OFFSET $4`,
      [bounds.startAt, bounds.endBefore, pagination.limit, pagination.offset]
    );
    let total = Number(result.rows[0]?.total_count || 0);
    if (!result.rows.length) {
      const countResult = await db.query(
        `SELECT COUNT(*)::int AS total
         FROM orders
         WHERE placed_at >= $1::timestamptz AND placed_at < $2::timestamptz`,
        [bounds.startAt, bounds.endBefore]
      );
      total = countResult.rows[0].total;
    }
    return res.json({
      success: true,
      data: result.rows.map(({ total_count: _totalCount, ...row }) => row),
      pagination: { ...pagination, total }
    });
  } catch (error) {
    return reportError(res, error, "orders");
  }
}

module.exports = { getAdminReportSummary, listAdminReportShops, listAdminReportOrders };