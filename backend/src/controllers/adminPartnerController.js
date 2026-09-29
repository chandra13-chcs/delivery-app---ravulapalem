"use strict";

const db = require("../config/db");
const { writeAuditLog } = require("../services/auditService");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS_TYPES = new Set(["RESTAURANT", "GROCERY", "MEAT", "OTHER"]);
const PARTNER_STATUSES = new Set(["PENDING", "ACTIVE", "SUSPENDED", "CLOSED"]);
const SHOP_STATUSES = new Set(["PENDING", "ACTIVE", "PAUSED", "SUSPENDED", "CLOSED"]);
const MEMBER_ROLES = new Set(["OWNER", "MANAGER", "STAFF"]);
const MEMBER_STATUSES = new Set(["ACTIVE", "SUSPENDED", "REMOVED"]);
const PRODUCT_STATUSES = new Set(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]);
const SHOP_FIELDS = new Set([
  "name", "description", "cuisine", "phone_e164", "email", "address_line1", "address_line2",
  "locality", "city", "state", "postal_code", "country_code", "latitude", "longitude"
]);
const SHOP_COLUMNS = [
  "name", "description", "cuisine", "phone_e164", "email", "address_line1", "address_line2",
  "locality", "city", "state", "postal_code", "country_code", "latitude", "longitude", "status"
].join(", ");

function respondError(res, status, message) {
  return res.status(status).json({ success: false, message, data: null });
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isValidImageReference(value) {
  if (typeof value !== "string" || value.length > 80000) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validatePartner(body, creating) {
  if (!isObject(body)) return { error: "A JSON object is required." };
  const allowed = new Set(["legal_name", "display_name", "business_type", "tax_identifier"]);
  if (Object.keys(body).some(key => !allowed.has(key))) return { error: "Unsupported partner field." };
  if (creating && ["legal_name", "display_name", "business_type"].some(key => !(key in body))) {
    return { error: "Legal name, display name, and business type are required." };
  }
  if (!creating && !Object.keys(body).length) return { error: "At least one partner field is required." };
  const value = {};
  for (const field of ["legal_name", "display_name"]) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string" || !body[field].trim() || body[field].trim().length > 200) {
      return { error: `${field} must be between 1 and 200 characters.` };
    }
    value[field] = body[field].trim();
  }
  if (body.business_type !== undefined) {
    if (typeof body.business_type !== "string" || !BUSINESS_TYPES.has(body.business_type)) return { error: "Unsupported business type." };
    value.business_type = body.business_type;
  }
  if (body.tax_identifier !== undefined) {
    if (body.tax_identifier !== null && (typeof body.tax_identifier !== "string" || body.tax_identifier.trim().length > 100)) {
      return { error: "tax_identifier must be null or at most 100 characters." };
    }
    value.tax_identifier = body.tax_identifier == null || !body.tax_identifier.trim() ? null : body.tax_identifier.trim();
  }
  return { value };
}

function validateShop(body, creating) {
  if (!isObject(body)) return { error: "A JSON object is required." };
  if (Object.keys(body).some(key => !SHOP_FIELDS.has(key))) return { error: "Unsupported shop field." };
  if (creating && ["name", "address_line1", "city", "state", "postal_code"].some(key => !(key in body))) {
    return { error: "Name, address, city, state, and postal code are required." };
  }
  if (!creating && !Object.keys(body).length) return { error: "At least one shop field is required." };
  const value = {};
  for (const field of SHOP_FIELDS) {
    if (body[field] === undefined) continue;
    const fieldValue = body[field];
    if (["latitude", "longitude"].includes(field)) {
      if (fieldValue === null || fieldValue === "") value[field] = null;
      else {
        const number = Number(fieldValue);
        const limit = field === "latitude" ? 90 : 180;
        if (!Number.isFinite(number) || number < -limit || number > limit) return { error: `${field} is outside its valid range.` };
        value[field] = number;
      }
    } else if (["description", "cuisine", "address_line2", "locality", "phone_e164", "email"].includes(field)) {
      if (fieldValue !== null && typeof fieldValue !== "string") return { error: `${field} must be a string or null.` };
      const normalized = fieldValue == null || !fieldValue.trim() ? null : fieldValue.trim();
      const maxLength = field === "description" ? 5000 : field === "cuisine" ? 200 : 1000;
      if (normalized && normalized.length > maxLength) return { error: `${field} is too long.` };
      value[field] = normalized;
    } else {
      const maxLength = field === "name" ? 200 : field === "address_line1" ? 500 : field === "postal_code" ? 16 : field === "country_code" ? 2 : 100;
      if (typeof fieldValue !== "string" || !fieldValue.trim() || fieldValue.trim().length > maxLength) {
        return { error: `${field} must be a non-empty string of at most ${maxLength} characters.` };
      }
      value[field] = fieldValue.trim();
    }
  }
  if (value.country_code && !/^[A-Za-z]{2}$/.test(value.country_code)) return { error: "country_code must contain two letters." };
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) return { error: "email is invalid." };
  if (value.phone_e164 && !/^\+[1-9][0-9]{7,14}$/.test(value.phone_e164)) return { error: "phone_e164 must use international format." };
  return { value };
}

async function updateFields(client, table, id, allowedFields, value, whereSql, whereValues) {
  const fields = Object.keys(value).filter(field => allowedFields.has(field));
  const values = [...whereValues];
  const assignments = fields.map(field => {
    values.push(value[field]);
    return `${field} = $${values.length}`;
  });
  assignments.push("updated_at = now()");
  const result = await client.query(
    `UPDATE ${table} SET ${assignments.join(", ")} WHERE ${whereSql} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

async function listAdminPartners(req, res) {
  try {
    const result = await db.query(
      `SELECT p.id, p.legal_name, p.display_name, p.business_type, p.tax_identifier, p.status,
              p.created_at, p.updated_at,
              COALESCE(shop_stats.shop_count, 0)::int AS shop_count,
              COALESCE(shop_stats.active_shop_count, 0)::int AS active_shop_count,
              COALESCE(catalog.product_count, 0)::int AS product_count,
              COALESCE(catalog.active_product_count, 0)::int AS active_product_count,
              COALESCE(members.member_count, 0)::int AS member_count
       FROM partners p
       LEFT JOIN LATERAL (
         SELECT count(*) AS shop_count, count(*) FILTER (WHERE status = 'ACTIVE') AS active_shop_count
         FROM shops WHERE partner_id = p.id AND deleted_at IS NULL
       ) shop_stats ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS product_count, count(*) FILTER (WHERE pr.status = 'ACTIVE') AS active_product_count
         FROM products pr JOIN shops s ON s.id = pr.shop_id
         WHERE s.partner_id = p.id AND s.deleted_at IS NULL AND pr.deleted_at IS NULL
       ) catalog ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS member_count FROM partner_members WHERE partner_id = p.id AND status = 'ACTIVE'
       ) members ON true
       WHERE p.deleted_at IS NULL
       ORDER BY p.created_at DESC, p.id` 
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Admin partner listing failed:", error.message);
    return respondError(res, 500, "Unable to retrieve partners.");
  }
}

async function getAdminPartner(req, res) {
  const { partnerId } = req.params;
  if (!isUuid(partnerId)) return respondError(res, 400, "Invalid partner id.");
  try {
    const result = await db.query(
      `SELECT p.id, p.legal_name, p.display_name, p.business_type, p.tax_identifier, p.status,
              p.created_at, p.updated_at
       FROM partners p WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [partnerId]
    );
    if (!result.rows[0]) return respondError(res, 404, "Partner not found.");
    const [shops, members] = await Promise.all([
      db.query(
        `SELECT s.id, s.partner_id, s.name, s.description, s.phone_e164, s.email,
                s.address_line1, s.address_line2, s.locality, s.city, s.state, s.postal_code,
                s.country_code, s.status, s.created_at, s.updated_at,
                count(DISTINCT pr.id)::int AS product_count,
                count(DISTINCT pr.id) FILTER (WHERE pr.status = 'ACTIVE')::int AS active_product_count,
                COALESCE(sum(i.quantity_on_hand), 0)::numeric AS stock_quantity
         FROM shops s
         LEFT JOIN products pr ON pr.shop_id = s.id AND pr.deleted_at IS NULL
         LEFT JOIN product_variants pv ON pv.product_id = pr.id AND pv.deleted_at IS NULL
         LEFT JOIN inventory i ON i.variant_id = pv.id
         WHERE s.partner_id = $1 AND s.deleted_at IS NULL
         GROUP BY s.id ORDER BY s.created_at, s.id`,
        [partnerId]
      ),
      db.query(
        `SELECT pm.user_id, u.display_name, u.email, u.phone_e164, pm.member_role, pm.status,
                pm.created_at, pm.updated_at
         FROM partner_members pm JOIN users u ON u.id = pm.user_id
         WHERE pm.partner_id = $1 ORDER BY pm.created_at, pm.user_id`,
        [partnerId]
      )
    ]);
    return res.json({ success: true, data: { ...result.rows[0], shops: shops.rows, members: members.rows } });
  } catch (error) {
    console.error("Admin partner retrieval failed:", error.message);
    return respondError(res, 500, "Unable to retrieve partner details.");
  }
}

async function createAdminPartner(req, res) {
  const validation = validatePartner(req.body, true);
  if (validation.error) return respondError(res, 400, validation.error);
  const { legal_name, display_name, business_type, tax_identifier = null } = validation.value;
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO partners (legal_name, display_name, business_type, tax_identifier, status)
       VALUES ($1, $2, $3, $4, 'PENDING') RETURNING id, legal_name, display_name, business_type, tax_identifier, status, created_at`,
      [legal_name, display_name, business_type, tax_identifier]
    );
    await writeAuditLog(client, req, "partner.created", "partners", result.rows[0].id, null, result.rows[0]);
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return respondError(res, 409, "A partner with that tax identifier already exists.");
    console.error("Admin partner creation failed:", error.message);
    return respondError(res, 500, "Unable to create partner.");
  } finally {
    client?.release();
  }
}

async function updateAdminPartner(req, res) {
  const { partnerId } = req.params;
  if (!isUuid(partnerId)) return respondError(res, 400, "Invalid partner id.");
  const validation = validatePartner(req.body, false);
  if (validation.error) return respondError(res, 400, validation.error);
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await client.query("SELECT * FROM partners WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [partnerId]);
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Partner not found.");
    }
    const after = await updateFields(client, "partners", partnerId, new Set(Object.keys(validation.value)), validation.value, "id = $1 AND deleted_at IS NULL", [partnerId]);
    if (!after) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Partner not found.");
    }
    await writeAuditLog(client, req, "partner.updated", "partners", partnerId, before.rows[0], after);
    await client.query("COMMIT");
    return res.json({ success: true, data: after });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return respondError(res, 409, "A partner with that tax identifier already exists.");
    console.error("Admin partner update failed:", error.message);
    return respondError(res, 500, "Unable to update partner.");
  } finally {
    client?.release();
  }
}

async function updateAdminPartnerStatus(req, res) {
  const { partnerId } = req.params;
  const status = req.body?.status;
  if (!isUuid(partnerId)) return respondError(res, 400, "Invalid partner id.");
  if (!PARTNER_STATUSES.has(status)) return respondError(res, 400, "Unsupported partner status.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await client.query("SELECT id, status FROM partners WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [partnerId]);
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Partner not found.");
    }
    const result = await client.query(
      "UPDATE partners SET status = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id, status, updated_at",
      [partnerId, status]
    );
    await writeAuditLog(client, req, "partner.status_changed", "partners", partnerId, before.rows[0], result.rows[0]);
    await client.query("COMMIT");
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Admin partner status update failed:", error.message);
    return respondError(res, 500, "Unable to update partner status.");
  } finally {
    client?.release();
  }
}

async function listAdminPartnerMembers(req, res) {
  return getAdminPartner(req, res);
}

async function addAdminPartnerMember(req, res) {
  const { partnerId } = req.params;
  const { user_id: userId, member_role: memberRole = "STAFF" } = req.body || {};
  if (!isUuid(partnerId) || !isUuid(userId)) return respondError(res, 400, "Valid partner id and user_id are required.");
  if (!MEMBER_ROLES.has(memberRole)) return respondError(res, 400, "Unsupported member role.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const partner = await client.query("SELECT id FROM partners WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [partnerId]);
    const user = await client.query("SELECT id FROM users WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL", [userId]);
    if (!partner.rows[0] || !user.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, !partner.rows[0] ? "Partner not found." : "Active user not found.");
    }
    const before = await client.query("SELECT * FROM partner_members WHERE partner_id = $1 AND user_id = $2 FOR UPDATE", [partnerId, userId]);
    const result = await client.query(
      `INSERT INTO partner_members (partner_id, user_id, member_role, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       ON CONFLICT (partner_id, user_id) DO UPDATE
       SET member_role = EXCLUDED.member_role, status = 'ACTIVE', updated_at = now()
       RETURNING id, partner_id, user_id, member_role, status, created_at, updated_at`,
      [partnerId, userId, memberRole]
    );
    await writeAuditLog(client, req, "partner.member_changed", "partner_members", result.rows[0].id, before.rows[0] || null, result.rows[0]);
    await client.query("COMMIT");
    return res.status(before.rows[0] ? 200 : 201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Admin partner member update failed:", error.message);
    return respondError(res, 500, "Unable to update partner member.");
  } finally {
    client?.release();
  }
}

async function updateAdminPartnerMember(req, res) {
  const { partnerId, userId } = req.params;
  const { member_role: memberRole, status } = req.body || {};
  if (!isUuid(partnerId) || !isUuid(userId)) return respondError(res, 400, "Invalid partner or user id.");
  if ((memberRole !== undefined && !MEMBER_ROLES.has(memberRole)) || (status !== undefined && !MEMBER_STATUSES.has(status))) {
    return respondError(res, 400, "Unsupported partner membership value.");
  }
  if (memberRole === undefined && status === undefined) return respondError(res, 400, "Provide member_role or status.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await client.query("SELECT * FROM partner_members WHERE partner_id = $1 AND user_id = $2 FOR UPDATE", [partnerId, userId]);
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Partner member not found.");
    }
    const value = {};
    if (memberRole !== undefined) value.member_role = memberRole;
    if (status !== undefined) value.status = status;
    const after = await updateFields(client, "partner_members", before.rows[0].id, new Set(Object.keys(value)), value, "id = $1", [before.rows[0].id]);
    await writeAuditLog(client, req, "partner.member_changed", "partner_members", after.id, before.rows[0], after);
    await client.query("COMMIT");
    return res.json({ success: true, data: after });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Admin partner member update failed:", error.message);
    return respondError(res, 500, "Unable to update partner member.");
  } finally {
    client?.release();
  }
}

async function createAdminShop(req, res) {
  const { partnerId } = req.params;
  if (!isUuid(partnerId)) return respondError(res, 400, "Invalid partner id.");
  const validation = validateShop(req.body, true);
  if (validation.error) return respondError(res, 400, validation.error);
  const value = validation.value;
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO shops (partner_id, name, description, cuisine, phone_e164, email,
         address_line1, address_line2, locality, city, state, postal_code, country_code,
         latitude, longitude, status)
       SELECT p.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, 'IN'), $14, $15, 'PENDING'
       FROM partners p WHERE p.id = $1 AND p.deleted_at IS NULL AND p.status <> 'CLOSED'
       RETURNING id, partner_id, ${SHOP_COLUMNS}, created_at, updated_at`,
      [partnerId, value.name, value.description ?? null, value.cuisine ?? null, value.phone_e164 ?? null,
        value.email ?? null, value.address_line1, value.address_line2 ?? null, value.locality ?? null,
        value.city, value.state, value.postal_code, value.country_code ?? null, value.latitude ?? null, value.longitude ?? null]
    );
    if (!inserted.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Partner not found or closed.");
    }
    await writeAuditLog(client, req, "shop.created", "shops", inserted.rows[0].id, null, inserted.rows[0]);
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: inserted.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23514" || error.code === "22P02") return respondError(res, 400, "Shop details are invalid.");
    console.error("Admin shop creation failed:", error.message);
    return respondError(res, 500, "Unable to create shop.");
  } finally {
    client?.release();
  }
}

async function updateAdminShop(req, res) {
  const { partnerId, shopId } = req.params;
  if (!isUuid(partnerId) || !isUuid(shopId)) return respondError(res, 400, "Invalid partner or shop id.");
  const isStatusUpdate = Object.keys(req.body || {}).length === 1 && req.body.status !== undefined;
  const validation = isStatusUpdate
    ? { value: { status: req.body.status } }
    : validateShop(req.body, false);
  if (validation.error) return respondError(res, 400, validation.error);
  if (isStatusUpdate && !SHOP_STATUSES.has(validation.value.status)) return respondError(res, 400, "Unsupported shop status.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await client.query(
      `SELECT s.* FROM shops s
       JOIN partners p ON p.id = s.partner_id
       WHERE s.id = $1 AND s.partner_id = $2 AND s.deleted_at IS NULL AND p.deleted_at IS NULL
       FOR UPDATE OF s`,
      [shopId, partnerId]
    );
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Shop not found under this partner.");
    }
    const allowedFields = new Set(Object.keys(validation.value));
    const after = await updateFields(client, "shops", shopId, allowedFields, validation.value, "id = $1 AND partner_id = $2 AND deleted_at IS NULL", [shopId, partnerId]);
    await writeAuditLog(client, req, isStatusUpdate ? "shop.status_changed" : "shop.updated", "shops", shopId, before.rows[0], after);
    await client.query("COMMIT");
    return res.json({ success: true, data: after });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23514" || error.code === "22P02") return respondError(res, 400, "Shop details are invalid.");
    console.error("Admin shop update failed:", error.message);
    return respondError(res, 500, "Unable to update shop.");
  } finally {
    client?.release();
  }
}

async function getAdminShopProducts(req, res) {
  const { partnerId, shopId } = req.params;
  if (!isUuid(partnerId) || !isUuid(shopId)) return respondError(res, 400, "Invalid partner or shop id.");
  try {
    const result = await db.query(
      `SELECT p.id, p.shop_id, p.category_id, p.name, p.description, p.brand, p.status,
              p.created_at, p.updated_at,
              COALESCE(variants.items, '[]'::jsonb) AS variants,
              COALESCE(images.items, '[]'::jsonb) AS images
       FROM products p JOIN shops s ON s.id = p.shop_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'id', pv.id, 'sku', pv.sku, 'name', pv.name, 'unit_label', pv.unit_label,
           'unit_quantity', pv.unit_quantity, 'price', pv.price, 'compare_at_price', pv.compare_at_price,
           'is_default', pv.is_default, 'is_active', pv.is_active,
           'quantity_on_hand', COALESCE(i.quantity_on_hand, 0),
           'quantity_reserved', COALESCE(i.quantity_reserved, 0),
           'low_stock_threshold', COALESCE(i.low_stock_threshold, 0)
         ) ORDER BY pv.is_default DESC, pv.name) AS items
         FROM product_variants pv LEFT JOIN inventory i ON i.variant_id = pv.id
         WHERE pv.product_id = p.id AND pv.deleted_at IS NULL
       ) variants ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('id', pi.id, 'public_url', pi.public_url, 'alt_text', pi.alt_text, 'sort_order', pi.sort_order)
           ORDER BY pi.sort_order, pi.id) AS items
         FROM product_images pi WHERE pi.product_id = p.id
       ) images ON true
       WHERE p.shop_id = $1 AND s.partner_id = $2 AND p.deleted_at IS NULL AND s.deleted_at IS NULL
       ORDER BY p.created_at DESC, p.id`,
      [shopId, partnerId]
    );
    const shop = await db.query("SELECT id FROM shops WHERE id = $1 AND partner_id = $2 AND deleted_at IS NULL", [shopId, partnerId]);
    if (!shop.rows[0]) return respondError(res, 404, "Shop not found under this partner.");
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Admin shop catalog lookup failed:", error.message);
    return respondError(res, 500, "Unable to retrieve shop products.");
  }
}

async function getAdminShopInventory(req, res) {
  const { partnerId, shopId } = req.params;
  if (!isUuid(partnerId) || !isUuid(shopId)) return respondError(res, 400, "Invalid partner or shop id.");
  try {
    const result = await db.query(
      `SELECT p.id AS product_id, p.name AS product_name, p.status AS product_status,
              pv.id AS variant_id, pv.name AS variant_name, pv.sku, pv.price, pv.is_active,
              COALESCE(i.quantity_on_hand, 0) AS quantity_on_hand,
              COALESCE(i.quantity_reserved, 0) AS quantity_reserved,
              COALESCE(i.low_stock_threshold, 0) AS low_stock_threshold, i.updated_at
       FROM shops s JOIN products p ON p.shop_id = s.id AND p.deleted_at IS NULL
       JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
       LEFT JOIN inventory i ON i.variant_id = pv.id
       WHERE s.id = $1 AND s.partner_id = $2 AND s.deleted_at IS NULL
       ORDER BY p.name, pv.is_default DESC, pv.name`,
      [shopId, partnerId]
    );
    const shop = await db.query("SELECT id FROM shops WHERE id = $1 AND partner_id = $2 AND deleted_at IS NULL", [shopId, partnerId]);
    if (!shop.rows[0]) return respondError(res, 404, "Shop not found under this partner.");
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Admin shop inventory lookup failed:", error.message);
    return respondError(res, 500, "Unable to retrieve shop inventory.");
  }
}

async function queryAdminCatalogProducts(filters, productId = null) {
  const values = [];
  const clauses = ["p.deleted_at IS NULL", "s.deleted_at IS NULL", "partner.deleted_at IS NULL"];
  const addFilter = (column, value, cast = "") => {
    if (!value) return;
    values.push(value);
    clauses.push(`${column} = $${values.length}${cast}`);
  };
  addFilter("s.partner_id", filters.partner_id, "::uuid");
  addFilter("p.shop_id", filters.shop_id, "::uuid");
  addFilter("p.category_id", filters.category_id, "::uuid");
  if (filters.status && filters.status !== "ALL") addFilter("p.status", filters.status);
  if (productId) addFilter("p.id", productId, "::uuid");
  values.push(200);
  return db.query(
    `SELECT p.id, p.shop_id, s.partner_id, p.category_id, p.name, p.description, p.brand, p.status,
            p.created_at, p.updated_at, s.name AS shop_name, partner.display_name AS partner_name,
            COALESCE(variants.items, '[]'::jsonb) AS variants,
            COALESCE(images.items, '[]'::jsonb) AS images
     FROM products p
     JOIN shops s ON s.id = p.shop_id
     JOIN partners partner ON partner.id = s.partner_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'id', pv.id, 'sku', pv.sku, 'name', pv.name, 'unit_label', pv.unit_label,
         'unit_quantity', pv.unit_quantity, 'price', pv.price, 'compare_at_price', pv.compare_at_price,
         'is_default', pv.is_default, 'is_active', pv.is_active,
         'quantity_on_hand', COALESCE(i.quantity_on_hand, 0),
         'quantity_reserved', COALESCE(i.quantity_reserved, 0),
         'low_stock_threshold', COALESCE(i.low_stock_threshold, 0)
       ) ORDER BY pv.is_default DESC, pv.name) AS items
       FROM product_variants pv LEFT JOIN inventory i ON i.variant_id = pv.id
       WHERE pv.product_id = p.id AND pv.deleted_at IS NULL
     ) variants ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object('id', pi.id, 'public_url', pi.public_url, 'alt_text', pi.alt_text, 'sort_order', pi.sort_order)
         ORDER BY pi.sort_order, pi.id) AS items
       FROM product_images pi WHERE pi.product_id = p.id
     ) images ON true
     WHERE ${clauses.join(" AND ")}
     ORDER BY p.updated_at DESC, p.id
     LIMIT $${values.length}`,
    values
  );
}

async function listAdminCatalogProducts(req, res) {
  const filters = req.query || {};
  const allowed = new Set(["partner_id", "shop_id", "category_id", "status"]);
  if (Object.keys(filters).some(key => !allowed.has(key))) return respondError(res, 400, "Unsupported catalog filter.");
  for (const field of ["partner_id", "shop_id", "category_id"]) {
    if (filters[field] != null && !isUuid(filters[field])) return respondError(res, 400, `Invalid ${field}.`);
  }
  if (filters.status && filters.status !== "ALL" && !PRODUCT_STATUSES.has(filters.status)) return respondError(res, 400, "Unsupported product status filter.");
  try {
    const result = await queryAdminCatalogProducts(filters);
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Admin catalog listing failed:", error.message);
    return respondError(res, 500, "Unable to retrieve catalog products.");
  }
}

async function getAdminCatalogProduct(req, res) {
  const { productId } = req.params;
  if (!isUuid(productId)) return respondError(res, 400, "Invalid product id.");
  try {
    const result = await queryAdminCatalogProducts({}, productId);
    if (!result.rows[0]) return respondError(res, 404, "Product not found.");
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Admin catalog product lookup failed:", error.message);
    return respondError(res, 500, "Unable to retrieve product.");
  }
}

async function updateAdminCatalogProduct(req, res) {
  const { productId } = req.params;
  const body = req.body;
  const allowed = new Set(["name", "description", "brand", "category_id", "status", "image_url"]);
  if (!isUuid(productId)) return respondError(res, 400, "Invalid product id.");
  if (!isObject(body) || !Object.keys(body).length || Object.keys(body).some(key => !allowed.has(key))) {
    return respondError(res, 400, "Unsupported product field.");
  }
  const value = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 300) return respondError(res, 400, "Product name is invalid.");
    value.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (body.description !== null && (typeof body.description !== "string" || body.description.length > 5000)) return respondError(res, 400, "Product description is invalid.");
    value.description = body.description;
  }
  if (body.brand !== undefined) {
    if (body.brand !== null && (typeof body.brand !== "string" || body.brand.length > 200)) return respondError(res, 400, "Product brand is invalid.");
    value.brand = body.brand;
  }
  if (body.category_id !== undefined) {
    if (body.category_id !== null && !isUuid(body.category_id)) return respondError(res, 400, "Invalid category id.");
    value.category_id = body.category_id;
  }
  if (body.status !== undefined) {
    if (!PRODUCT_STATUSES.has(body.status)) return respondError(res, 400, "Unsupported product status.");
    value.status = body.status;
  }
  if (body.image_url !== undefined) {
    if (!isValidImageReference(body.image_url)) return respondError(res, 400, "Product image URL is invalid.");
    value.image_url = body.image_url;
  }
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await client.query("SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [productId]);
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Product not found.");
    }
    if (value.category_id) {
      const category = await client.query("SELECT id FROM categories WHERE id = $1 AND is_active = true AND deleted_at IS NULL", [value.category_id]);
      if (!category.rows[0]) {
        await client.query("ROLLBACK");
        return respondError(res, 400, "Category is not active.");
      }
    }
    if (value.status === "ACTIVE") {
      const activeVariant = await client.query("SELECT id FROM product_variants WHERE product_id = $1 AND is_active = true AND deleted_at IS NULL LIMIT 1", [productId]);
      if (!activeVariant.rows[0]) {
        await client.query("ROLLBACK");
        return respondError(res, 409, "Activate a variant before activating the product.");
      }
    }
    const imageUrl = value.image_url;
    delete value.image_url;
    const values = [productId];
    const assignments = [];
    for (const [field, fieldValue] of Object.entries(value)) {
      values.push(fieldValue);
      assignments.push(`${field} = $${values.length}`);
    }
    assignments.push("updated_at = now()");
    const updated = await client.query(`UPDATE products SET ${assignments.join(", ")} WHERE id = $1 RETURNING *`, values);
    if (imageUrl !== undefined) {
      await client.query(
        `INSERT INTO product_images (product_id, object_key, public_url, alt_text, sort_order)
         VALUES ($1, $2, $3, $4, 0)
         ON CONFLICT (product_id, object_key) DO UPDATE
         SET public_url = EXCLUDED.public_url, alt_text = EXCLUDED.alt_text`,
        [productId, `admin-console:${productId}`, imageUrl, updated.rows[0].name]
      );
    }
    await writeAuditLog(client, req, "admin.product.updated", "products", productId, before.rows[0], { ...updated.rows[0], ...(imageUrl !== undefined ? { image_url: imageUrl } : {}) });
    await client.query("COMMIT");
    return res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23514" || error.code === "22P02") return respondError(res, 400, "Product values are invalid.");
    console.error("Admin product update failed:", error.message);
    return respondError(res, 500, "Unable to update product.");
  } finally {
    client?.release();
  }
}

async function createAdminCatalogVariant(req, res) {
  const { productId } = req.params;
  const body = req.body;
  const allowed = new Set(["name", "sku", "unit_label", "unit_quantity", "price", "compare_at_price", "is_active"]);
  if (!isUuid(productId)) return respondError(res, 400, "Invalid product id.");
  if (!isObject(body) || Object.keys(body).some(key => !allowed.has(key))) return respondError(res, 400, "Unsupported variant field.");
  const name = typeof body.name === "string" ? body.name.trim() : "Default";
  const sku = typeof body.sku === "string" ? body.sku.trim() || null : null;
  const unitLabel = typeof body.unit_label === "string" ? body.unit_label.trim() : "1 pc";
  const unitQuantity = Number(body.unit_quantity ?? 1);
  const price = Number(body.price);
  const compareAtPrice = body.compare_at_price == null || body.compare_at_price === "" ? null : Number(body.compare_at_price);
  const isActive = body.is_active == null ? true : body.is_active;
  if (!name || name.length > 200 || (sku != null && sku.length > 200) || !unitLabel || unitLabel.length > 100
      || !Number.isFinite(unitQuantity) || unitQuantity <= 0 || unitQuantity > 999999999.999
      || !Number.isFinite(price) || price < 0 || price > 9999999999.99
      || (compareAtPrice != null && (!Number.isFinite(compareAtPrice) || compareAtPrice < price || compareAtPrice > 9999999999.99))
      || typeof isActive !== "boolean") return respondError(res, 400, "Variant values are invalid.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const product = await client.query("SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [productId]);
    if (!product.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Product not found.");
    }
    const result = await client.query(
      `INSERT INTO product_variants
         (product_id, sku, name, unit_label, unit_quantity, price, compare_at_price, is_default, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
       RETURNING id, product_id, sku, name, unit_label, unit_quantity, price, compare_at_price, is_default, is_active`,
      [productId, sku, name, unitLabel, unitQuantity, price, compareAtPrice, isActive]
    );
    await client.query("INSERT INTO inventory (variant_id, quantity_on_hand) VALUES ($1, 0)", [result.rows[0].id]);
    await writeAuditLog(client, req, "admin.variant.created", "product_variants", result.rows[0].id, null, result.rows[0]);
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return respondError(res, 409, "SKU already exists.");
    if (["23514", "22P02", "22003"].includes(error.code)) return respondError(res, 400, "Variant values are invalid.");
    console.error("Admin variant creation failed:", error.message);
    return respondError(res, 500, "Unable to create variant.");
  } finally {
    client?.release();
  }
}

async function rollbackBadRequest(client, res, message) {
  await client.query("ROLLBACK");
  return respondError(res, 400, message);
}

async function updateAdminCatalogVariant(req, res) {
  const { variantId } = req.params;
  const body = req.body;
  const allowed = new Set(["name", "sku", "unit_label", "unit_quantity", "price", "compare_at_price", "is_active"]);
  if (!isUuid(variantId)) return respondError(res, 400, "Invalid variant id.");
  if (!isObject(body) || !Object.keys(body).length || Object.keys(body).some(key => !allowed.has(key))) return respondError(res, 400, "Unsupported variant field.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await client.query("SELECT * FROM product_variants WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [variantId]);
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Variant not found.");
    }
    const next = { ...before.rows[0] };
    for (const [field, value] of Object.entries(body)) {
      if (["name", "unit_label"].includes(field)) {
        const limit = field === "name" ? 200 : 100;
        if (typeof value !== "string" || !value.trim() || value.trim().length > limit) return await rollbackBadRequest(client, res, `${field} is invalid.`);
        next[field] = value.trim();
      } else if (field === "sku") {
        if (value !== null && (typeof value !== "string" || value.trim().length > 200)) return await rollbackBadRequest(client, res, "SKU is invalid.");
        next.sku = value == null || !value.trim() ? null : value.trim();
      } else if (field === "is_active") {
        if (typeof value !== "boolean") return await rollbackBadRequest(client, res, "is_active must be boolean.");
        next.is_active = value;
      } else if (field === "compare_at_price" && value === null) {
        next.compare_at_price = null;
      } else {
        const number = Number(value);
        const min = field === "unit_quantity" ? 0.001 : 0;
        const max = field === "unit_quantity" ? 999999999.999 : 9999999999.99;
        if (!Number.isFinite(number) || number < min || number > max) return await rollbackBadRequest(client, res, `${field} is invalid.`);
        next[field] = number;
      }
    }
    if (next.compare_at_price != null && Number(next.compare_at_price) < Number(next.price)) return await rollbackBadRequest(client, res, "compare_at_price cannot be below price.");
    const values = [variantId];
    const assignments = Object.keys(body).map(field => {
      values.push(next[field]);
      return `${field} = $${values.length}`;
    });
    assignments.push("updated_at = now()");
    const updated = await client.query(`UPDATE product_variants SET ${assignments.join(", ")} WHERE id = $1 RETURNING *`, values);
    await writeAuditLog(client, req, "admin.variant.updated", "product_variants", variantId, before.rows[0], updated.rows[0]);
    await client.query("COMMIT");
    return res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return respondError(res, 409, "SKU already exists.");
    if (["23514", "22P02", "22003"].includes(error.code)) return respondError(res, 400, "Variant values are invalid.");
    console.error("Admin variant update failed:", error.message);
    return respondError(res, 500, "Unable to update variant.");
  } finally {
    client?.release();
  }
}

async function updateAdminCatalogInventory(req, res) {
  const { variantId } = req.params;
  const body = req.body;
  const allowed = new Set(["quantity_on_hand", "low_stock_threshold"]);
  if (!isUuid(variantId)) return respondError(res, 400, "Invalid variant id.");
  if (!isObject(body) || !Object.keys(body).length || Object.keys(body).some(key => !allowed.has(key))) return respondError(res, 400, "Unsupported inventory field.");
  for (const [field, value] of Object.entries(body)) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 999999999.999) return respondError(res, 400, `${field} is invalid.`);
  }
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const variant = await client.query(
      `SELECT pv.id, pv.product_id, COALESCE(i.quantity_on_hand, 0) AS quantity_on_hand,
              COALESCE(i.quantity_reserved, 0) AS quantity_reserved,
              COALESCE(i.low_stock_threshold, 0) AS low_stock_threshold
       FROM product_variants pv LEFT JOIN inventory i ON i.variant_id = pv.id
       WHERE pv.id = $1 AND pv.deleted_at IS NULL FOR UPDATE OF pv`,
      [variantId]
    );
    if (!variant.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Variant not found.");
    }
    const row = variant.rows[0];
    const quantity = body.quantity_on_hand === undefined ? Number(row.quantity_on_hand) : Number(body.quantity_on_hand);
    const threshold = body.low_stock_threshold === undefined ? Number(row.low_stock_threshold) : Number(body.low_stock_threshold);
    if (quantity < Number(row.quantity_reserved)) {
      await client.query("ROLLBACK");
      return respondError(res, 409, "Quantity cannot be lower than reserved stock.");
    }
    const updated = await client.query(
      `INSERT INTO inventory (variant_id, quantity_on_hand, low_stock_threshold)
       VALUES ($1, $2, $3)
       ON CONFLICT (variant_id) DO UPDATE
       SET quantity_on_hand = EXCLUDED.quantity_on_hand,
           low_stock_threshold = EXCLUDED.low_stock_threshold, updated_at = now()
       RETURNING variant_id, quantity_on_hand, quantity_reserved, low_stock_threshold, updated_at`,
      [variantId, quantity, threshold]
    );
    await writeAuditLog(client, req, "admin.inventory.adjusted", "inventory", variantId, row, updated.rows[0]);
    await client.query("COMMIT");
    return res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (["23514", "22P02", "22003"].includes(error.code)) return respondError(res, 400, "Inventory values are invalid.");
    console.error("Admin inventory update failed:", error.message);
    return respondError(res, 500, "Unable to update inventory.");
  } finally {
    client?.release();
  }
}

async function createAdminPartnerProduct(req, res) {
  const { partnerId, shopId } = req.params;
  if (!isUuid(partnerId) || !isUuid(shopId)) return respondError(res, 400, "Invalid partner or shop id.");
  const body = req.body;
  const allowedFields = new Set(["name", "description", "brand", "category_id", "image_url", "variant"]);
  const variantFields = new Set(["name", "sku", "price", "compare_at_price", "unit_label", "unit_quantity", "is_active"]);
  if (!isObject(body) || Object.keys(body).some(field => !allowedFields.has(field))
      || !isObject(body.variant) || Object.keys(body.variant).some(field => !variantFields.has(field))) {
    return respondError(res, 400, "Unsupported product field.");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = body.description == null || body.description === "" ? null : body.description;
  const brand = body.brand == null || body.brand === "" ? null : body.brand;
  const categoryId = body.category_id || null;
  const imageUrl = body.image_url == null || body.image_url === "" ? null : body.image_url;
  const variantName = typeof body.variant.name === "string" ? body.variant.name.trim() : "Default";
  const sku = typeof body.variant.sku === "string" ? body.variant.sku.trim() || null : null;
  const price = Number(body.variant.price);
  const compareAtPrice = body.variant.compare_at_price == null || body.variant.compare_at_price === ""
    ? null : Number(body.variant.compare_at_price);
  const unitLabel = typeof body.variant.unit_label === "string" ? body.variant.unit_label.trim() : "1 pc";
  const unitQuantity = Number(body.variant.unit_quantity ?? 1);
  const isActive = body.variant.is_active == null ? true : body.variant.is_active;
  const validImage = imageUrl == null || isValidImageReference(imageUrl);
  if (!name || name.length > 300 || (description != null && (typeof description !== "string" || description.length > 5000))
      || (brand != null && (typeof brand !== "string" || brand.length > 200)) || (categoryId != null && !isUuid(categoryId))
      || !validImage || !variantName || variantName.length > 200 || (sku != null && sku.length > 200)
      || !unitLabel || unitLabel.length > 100 || !Number.isFinite(price) || price < 0 || price > 9999999999.99
      || !Number.isFinite(unitQuantity) || unitQuantity <= 0 || unitQuantity > 999999999.999
      || (compareAtPrice != null && (!Number.isFinite(compareAtPrice) || compareAtPrice < price || compareAtPrice > 9999999999.99))
      || typeof isActive !== "boolean") {
    return respondError(res, 400, "Product or variant values are invalid.");
  }

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const shop = await client.query(
      `SELECT s.id, s.status AS shop_status, p.status AS partner_status
       FROM shops s JOIN partners p ON p.id = s.partner_id
       WHERE s.id = $1 AND s.partner_id = $2 AND s.deleted_at IS NULL AND p.deleted_at IS NULL
       FOR UPDATE OF s, p`,
      [shopId, partnerId]
    );
    if (!shop.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Shop not found under this partner.");
    }
    if (categoryId) {
      const category = await client.query("SELECT id FROM categories WHERE id = $1 AND is_active = true AND deleted_at IS NULL", [categoryId]);
      if (!category.rows[0]) {
        await client.query("ROLLBACK");
        return respondError(res, 400, "The selected category is not active.");
      }
    }
    const productStatus = shop.rows[0].shop_status === "ACTIVE" && shop.rows[0].partner_status === "ACTIVE" ? "ACTIVE" : "DRAFT";
    const product = await client.query(
      `INSERT INTO products (shop_id, category_id, name, description, brand, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, shop_id, category_id, name, description, brand, status`,
      [shopId, categoryId, name, description, brand, productStatus]
    );
    const variant = await client.query(
      `INSERT INTO product_variants
         (product_id, sku, name, unit_label, unit_quantity, price, compare_at_price, is_default, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8) RETURNING id, price`,
      [product.rows[0].id, sku, variantName, unitLabel, unitQuantity, price, compareAtPrice, isActive]
    );
    await client.query("INSERT INTO inventory (variant_id, quantity_on_hand) VALUES ($1, 0)", [variant.rows[0].id]);
    if (imageUrl) {
      await client.query(
        `INSERT INTO product_images (product_id, object_key, public_url, alt_text, sort_order)
         VALUES ($1, $2, $3, $4, 0)`,
        [product.rows[0].id, `admin-console:${product.rows[0].id}`, imageUrl, name]
      );
    }
    const result = { ...product.rows[0], variant_id: variant.rows[0].id, price: Number(variant.rows[0].price) };
    await writeAuditLog(client, req, "admin.partner_product.created", "products", result.id, null, result);
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return respondError(res, 409, "Product SKU already exists.");
    if (error.code === "23514" || error.code === "22P02") return respondError(res, 400, "Product details are invalid.");
    console.error("Admin partner product creation failed:", error.message);
    return respondError(res, 500, "Unable to create partner product.");
  } finally {
    client?.release();
  }
}

module.exports = {
  listAdminPartners,
  getAdminPartner,
  createAdminPartner,
  updateAdminPartner,
  updateAdminPartnerStatus,
  listAdminPartnerMembers,
  addAdminPartnerMember,
  updateAdminPartnerMember,
  createAdminShop,
  updateAdminShop,
  getAdminShopProducts,
  getAdminShopInventory,
  createAdminPartnerProduct,
  listAdminCatalogProducts,
  getAdminCatalogProduct,
  updateAdminCatalogProduct,
  createAdminCatalogVariant,
  updateAdminCatalogVariant,
  updateAdminCatalogInventory
};
