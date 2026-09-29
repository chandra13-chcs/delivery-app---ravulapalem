"use strict";

const db = require("../config/db");
const { writeAuditLog } = require("../services/auditService");

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validUuid(value) {
  return typeof value === "string" && uuidPattern.test(value);
}

function badRequest(res, message) {
  return res.status(400).json({ success: false, message, data: null });
}

function notFound(res, message = "Shop not found.") {
  return res.status(404).json({ success: false, message, data: null });
}

function normalizeVariant(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const name = typeof input.name === "string" ? input.name.trim() : "Default";
  const unitLabel = typeof input.unit_label === "string" ? input.unit_label.trim() : "1 pc";
  const price = Number(input.price);
  const unitQuantity = input.unit_quantity == null ? 1 : Number(input.unit_quantity);
  const compareAtPrice = input.compare_at_price == null || input.compare_at_price === ""
    ? null
    : Number(input.compare_at_price);
  const sku = typeof input.sku === "string" ? input.sku.trim() || null : null;
  const isActive = input.is_active == null ? true : input.is_active;

  if (!name || name.length > 200 || !unitLabel || unitLabel.length > 100
      || !Number.isFinite(price) || price < 0 || price > 9999999999.99
      || !Number.isFinite(unitQuantity) || unitQuantity <= 0 || unitQuantity > 999999999.999
      || (compareAtPrice != null && (!Number.isFinite(compareAtPrice) || compareAtPrice < price || compareAtPrice > 9999999999.99))
      || (sku != null && sku.length > 200)
      || typeof isActive !== "boolean") return null;

  return { name, unitLabel, price, unitQuantity, compareAtPrice, sku, isActive };
}

function normalizeImageUrl(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 80000) return undefined;

  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function validationError(error) {
  if (error.code === "23505") return { status: 409, message: "A product variant with that SKU already exists." };
  if (["23514", "22P02", "22003"].includes(error.code)) return { status: 400, message: "The supplied values are not valid." };
  return null;
}

function validateProductBody(body) {
  const allowedFields = new Set(["name", "description", "brand", "category_id", "variant", "image_url"]);
  const allowedVariantFields = new Set(["name", "unit_label", "price", "unit_quantity", "compare_at_price", "sku", "is_active"]);
  if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(field => !allowedFields.has(field))
      || !body.variant || typeof body.variant !== "object" || Array.isArray(body.variant)
      || Object.keys(body.variant).some(field => !allowedVariantFields.has(field))) {
    return { error: "Unsupported product field." };
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = body?.description == null || body.description === "" ? null : body.description;
  const brand = body?.brand == null || body.brand === "" ? null : body.brand;
  const categoryId = body?.category_id || null;
  const variant = normalizeVariant(body?.variant);
  const imageUrl = normalizeImageUrl(body?.image_url);

  if (!name || name.length > 300 || (description != null && typeof description !== "string")
      || (description != null && description.length > 5000)
      || (brand != null && (typeof brand !== "string" || brand.length > 200))
      || (categoryId != null && !validUuid(categoryId)) || !variant || imageUrl === undefined) {
    return { error: "Provide a valid name, variant, category, and image URL." };
  }
  return { name, description, brand, categoryId, variant, imageUrl };
}

async function categoryIsAvailable(queryable, categoryId) {
  if (!categoryId) return true;
  const result = await queryable.query(
    "SELECT 1 FROM categories WHERE id = $1 AND is_active = true AND deleted_at IS NULL",
    [categoryId]
  );
  return Boolean(result.rows[0]);
}

async function saveProductImage(queryable, productId, imageUrl, productName) {
  if (!imageUrl) return;
  await queryable.query(
    `INSERT INTO product_images (product_id, object_key, public_url, alt_text, sort_order)
     VALUES ($1, $2, $3, $4, -1)
     ON CONFLICT (product_id, object_key) DO UPDATE
     SET public_url = EXCLUDED.public_url,
         alt_text = EXCLUDED.alt_text,
         sort_order = EXCLUDED.sort_order`,
    [productId, `partner-console:${productId}`, imageUrl, productName]
  );
}

function canManagePartner(req, partnerId) {
  return req.partnerMemberships?.some(item => item.partner_id === partnerId
    && ["OWNER", "MANAGER"].includes(item.member_role)) === true;
}

function validatePartnerShopUpdates(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "A JSON object is required." };
  const fields = {
    name: "name", description: "description", cuisine: "cuisine", phone_e164: "phone_e164",
    email: "email", address_line1: "address_line1", address_line2: "address_line2",
    locality: "locality", city: "city", state: "state", postal_code: "postal_code",
    country_code: "country_code", latitude: "latitude", longitude: "longitude"
  };
  if (Object.keys(body).some(field => !Object.prototype.hasOwnProperty.call(fields, field))) {
    return { error: "Unsupported shop field." };
  }
  const updates = [];
  const values = [];
  for (const [field, column] of Object.entries(fields)) {
    if (body[field] === undefined) continue;
    const value = body[field];
    if (["latitude", "longitude"].includes(field)) {
      if (value === null || value === "") values.push(null);
      else {
        const number = Number(value);
        const limit = field === "latitude" ? 90 : 180;
        if (!Number.isFinite(number) || number < -limit || number > limit) return { error: `${field} is invalid.` };
        values.push(number);
      }
    } else if (["description", "cuisine", "phone_e164", "email", "address_line2", "locality"].includes(field)) {
      if (value !== null && typeof value !== "string") return { error: `${field} must be a string or null.` };
      const normalized = value == null || !value.trim() ? null : value.trim();
      if (normalized && normalized.length > 1000) return { error: `${field} is too long.` };
      if (field === "phone_e164" && normalized && !/^\+[1-9][0-9]{7,14}$/.test(normalized)) return { error: "phone_e164 must use international format." };
      if (field === "email" && normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return { error: "email is invalid." };
      values.push(normalized);
    } else {
      const maxLength = field === "name" ? 200 : field === "address_line1" ? 500 : field === "postal_code" ? 16 : 100;
      if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) return { error: `${field} is invalid.` };
      if (field === "country_code" && !/^[A-Za-z]{2}$/.test(value.trim())) return { error: "country_code must contain two letters." };
      values.push(field === "country_code" ? value.trim().toUpperCase() : value.trim());
    }
    updates.push(`${column} = $${values.length + 2}`);
  }
  if (!updates.length) return { error: "At least one supported shop field is required." };
  return { updates, values };
}

async function updatePartnerShop(req, res) {
  const { shopId } = req.params;
  if (!validUuid(shopId)) return badRequest(res, "Invalid shop id.");
  const validation = validatePartnerShopUpdates(req.body);
  if (validation.error) return badRequest(res, validation.error);
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await client.query(
      "SELECT * FROM shops WHERE id = $1 AND partner_id = ANY($2::uuid[]) AND deleted_at IS NULL FOR UPDATE",
      [shopId, req.partnerIds]
    );
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return notFound(res);
    }
    if (!canManagePartner(req, before.rows[0].partner_id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "Partner owner or manager access required.", data: null });
    }
    const result = await client.query(
      `UPDATE shops SET ${validation.updates.join(", ")}, updated_at = now()
       WHERE id = $1 AND partner_id = ANY($2::uuid[]) AND deleted_at IS NULL
       RETURNING *`,
      [shopId, req.partnerIds, ...validation.values]
    );
    await writeAuditLog(client, req, "partner.shop.updated", "shops", shopId, before.rows[0], result.rows[0]);
    await client.query("COMMIT");
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Partner shop update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update partner shop.", data: null });
  } finally {
    client?.release();
  }
}

async function updatePartnerShopStatus(req, res) {
  const { shopId } = req.params;
  if (!validUuid(shopId)) return badRequest(res, "Invalid shop id.");
  const { status } = req.body || {};
  if (!["ACTIVE", "PAUSED"].includes(status)) return badRequest(res, "status must be ACTIVE or PAUSED.");

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await client.query(
      "SELECT * FROM shops WHERE id = $1 AND partner_id = ANY($2::uuid[]) AND deleted_at IS NULL FOR UPDATE",
      [shopId, req.partnerIds]
    );
    const shop = before.rows[0];
    if (!shop) {
      await client.query("ROLLBACK");
      return notFound(res);
    }
    if (!canManagePartner(req, shop.partner_id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "Partner owner or manager access required.", data: null });
    }
    if (!["ACTIVE", "PAUSED"].includes(shop.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Only active or paused shops can be toggled by a partner.", data: null });
    }
    const result = await client.query(
      "UPDATE shops SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, partner_id, name, status, updated_at",
      [shopId, status]
    );
    await writeAuditLog(client, req, "partner.shop.status_changed", "shops", shopId, shop, result.rows[0]);
    await client.query("COMMIT");
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Partner shop status update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update shop status.", data: null });
  } finally {
    client?.release();
  }
}

async function createPartnerProduct(req, res) {
  const { shopId } = req.params;
  if (!validUuid(shopId)) return badRequest(res, "Invalid shop id.");
  const input = validateProductBody(req.body);
  if (input.error) return badRequest(res, input.error);

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    if (!await categoryIsAvailable(client, input.categoryId)) {
      await client.query("ROLLBACK");
      return badRequest(res, "The selected category is not active.");
    }
    const productResult = await client.query(
      `INSERT INTO products (shop_id, category_id, name, description, brand, status)
       SELECT s.id, $3, $4, $5, $6, 'ACTIVE'
       FROM shops s
       WHERE s.id = $1 AND s.partner_id = ANY($2::uuid[]) AND s.deleted_at IS NULL
       RETURNING id, shop_id`,
      [shopId, req.partnerIds, input.categoryId, input.name, input.description, input.brand]
    );
    if (!productResult.rows[0]) {
      await client.query("ROLLBACK");
      return notFound(res);
    }
    const product = productResult.rows[0];
    const variantResult = await client.query(
      `INSERT INTO product_variants
         (product_id, sku, name, unit_label, unit_quantity, price, compare_at_price, is_default, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
       RETURNING id`,
      [product.id, input.variant.sku, input.variant.name, input.variant.unitLabel,
        input.variant.unitQuantity, input.variant.price, input.variant.compareAtPrice, input.variant.isActive]
    );
    await client.query("INSERT INTO inventory (variant_id, quantity_on_hand) VALUES ($1, 0)", [variantResult.rows[0].id]);
    await saveProductImage(client, product.id, input.imageUrl, input.name);
    await writeAuditLog(client, req, "partner.product.created", "products", product.id, null, {
      ...product, name: input.name, category_id: input.categoryId, variant_id: variantResult.rows[0].id
    });
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: { ...product, variant_id: variantResult.rows[0].id } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    const knownError = validationError(error);
    if (knownError) return res.status(knownError.status).json({ success: false, message: knownError.message, data: null });
    console.error("Partner product creation failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to create partner product.", data: null });
  } finally {
    client?.release();
  }
}

async function updatePartnerProduct(req, res) {
  const { shopId, productId } = req.params;
  if (!validUuid(shopId) || !validUuid(productId)) return badRequest(res, "Invalid shop or product id.");
  const input = validateProductBody(req.body);
  if (input.error) return badRequest(res, input.error);

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const productResult = await client.query(
      `SELECT p.* FROM products p
       JOIN shops s ON s.id = p.shop_id
       WHERE p.id = $1 AND p.shop_id = $2
         AND s.partner_id = ANY($3::uuid[])
         AND p.deleted_at IS NULL AND s.deleted_at IS NULL
       FOR UPDATE OF p`,
      [productId, shopId, req.partnerIds]
    );
    if (!productResult.rows[0]) {
      await client.query("ROLLBACK");
      return notFound(res, "Product not found.");
    }
    if (!await categoryIsAvailable(client, input.categoryId)) {
      await client.query("ROLLBACK");
      return badRequest(res, "The selected category is not active.");
    }

    await client.query(
      `UPDATE products
      SET category_id = $3, name = $4, description = $5, brand = $6, updated_at = now()
       WHERE id = $1 AND shop_id = $2 AND deleted_at IS NULL`,
      [productId, shopId, input.categoryId, input.name, input.description, input.brand]
    );
    const variantResult = await client.query(
      `SELECT id FROM product_variants
       WHERE product_id = $1 AND is_default = true AND deleted_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [productId]
    );
    if (variantResult.rows[0]) {
      await client.query(
        `UPDATE product_variants
         SET sku = $2, name = $3, unit_label = $4, unit_quantity = $5,
             price = $6, compare_at_price = $7, is_active = $8, updated_at = now()
         WHERE id = $1 AND product_id = $9 AND deleted_at IS NULL`,
        [variantResult.rows[0].id, input.variant.sku, input.variant.name, input.variant.unitLabel,
          input.variant.unitQuantity, input.variant.price, input.variant.compareAtPrice, input.variant.isActive, productId]
      );
    } else {
      const createdVariant = await client.query(
        `INSERT INTO product_variants
           (product_id, sku, name, unit_label, unit_quantity, price, compare_at_price, is_default, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
         RETURNING id`,
        [productId, input.variant.sku, input.variant.name, input.variant.unitLabel,
          input.variant.unitQuantity, input.variant.price, input.variant.compareAtPrice, input.variant.isActive]
      );
      await client.query("INSERT INTO inventory (variant_id, quantity_on_hand) VALUES ($1, 0)", [createdVariant.rows[0].id]);
    }
    await saveProductImage(client, productId, input.imageUrl, input.name);
    const afterProduct = await client.query("SELECT * FROM products WHERE id = $1", [productId]);
    const afterVariant = await client.query(
      "SELECT id, sku, name, unit_label, unit_quantity, price, compare_at_price, is_active FROM product_variants WHERE product_id = $1 AND is_default = true AND deleted_at IS NULL LIMIT 1",
      [productId]
    );
    await writeAuditLog(client, req, "partner.product.updated", "products", productId, productResult.rows[0], {
      ...afterProduct.rows[0], default_variant: afterVariant.rows[0] || null
    });
    await client.query("COMMIT");
    return res.json({ success: true, data: { id: productId, shop_id: shopId } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    const knownError = validationError(error);
    if (knownError) return res.status(knownError.status).json({ success: false, message: knownError.message, data: null });
    console.error("Partner product update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update partner product.", data: null });
  } finally {
    client?.release();
  }
}

async function deactivatePartnerProduct(req, res) {
  const { shopId, productId } = req.params;
  if (!validUuid(shopId) || !validUuid(productId)) return badRequest(res, "Invalid shop or product id.");

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await client.query(
      `SELECT p.* FROM products p JOIN shops s ON s.id = p.shop_id
       WHERE p.id = $1 AND p.shop_id = $2 AND s.partner_id = ANY($3::uuid[])
         AND p.deleted_at IS NULL AND s.deleted_at IS NULL FOR UPDATE OF p`,
      [productId, shopId, req.partnerIds]
    );
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return notFound(res, "Product not found.");
    }
    const result = await client.query(
      "UPDATE products SET status = 'PAUSED', updated_at = now() WHERE id = $1 RETURNING id, shop_id, status",
      [productId]
    );
    await writeAuditLog(client, req, "partner.product.deactivated", "products", productId, before.rows[0], result.rows[0]);
    await client.query("COMMIT");
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Partner product deactivation failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to deactivate partner product.", data: null });
  } finally {
    client?.release();
  }
}

async function updatePartnerProductStatus(req, res) {
  const { shopId, productId } = req.params;
  const status = req.body?.status;
  if (!validUuid(shopId) || !validUuid(productId)) return badRequest(res, "Invalid shop or product id.");
  if (!["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"].includes(status)) return badRequest(res, "Unsupported product status.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await client.query(
      `SELECT p.* FROM products p JOIN shops s ON s.id = p.shop_id
       WHERE p.id = $1 AND p.shop_id = $2 AND s.partner_id = ANY($3::uuid[])
         AND p.deleted_at IS NULL AND s.deleted_at IS NULL FOR UPDATE OF p`,
      [productId, shopId, req.partnerIds]
    );
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return notFound(res, "Product not found.");
    }
    if (status === "ACTIVE") {
      const available = await client.query(
        "SELECT 1 FROM product_variants WHERE product_id = $1 AND is_active = true AND deleted_at IS NULL LIMIT 1",
        [productId]
      );
      if (!available.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Activate at least one variant before activating this product.", data: null });
      }
    }
    const updated = await client.query(
      "UPDATE products SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, shop_id, status, updated_at",
      [productId, status]
    );
    await writeAuditLog(client, req, "partner.product.status_changed", "products", productId, before.rows[0], updated.rows[0]);
    await client.query("COMMIT");
    return res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Partner product status update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update product status.", data: null });
  } finally {
    client?.release();
  }
}

async function createPartnerVariant(req, res) {
  const { shopId, productId } = req.params;
  if (!validUuid(shopId) || !validUuid(productId)) return badRequest(res, "Invalid shop or product id.");
  const allowedFields = new Set(["name", "unit_label", "price", "unit_quantity", "compare_at_price", "sku", "is_active"]);
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)
      || Object.keys(req.body).some(field => !allowedFields.has(field))) return badRequest(res, "Unsupported variant field.");
  const variant = normalizeVariant(req.body);
  if (!variant || variant.price > 9999999999.99 || variant.unitQuantity > 999999999.999) return badRequest(res, "Variant values are invalid or exceed database limits.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const product = await client.query(
      `SELECT p.id, p.shop_id FROM products p JOIN shops s ON s.id = p.shop_id
       WHERE p.id = $1 AND p.shop_id = $2 AND s.partner_id = ANY($3::uuid[])
         AND p.deleted_at IS NULL AND s.deleted_at IS NULL FOR UPDATE OF p`,
      [productId, shopId, req.partnerIds]
    );
    if (!product.rows[0]) {
      await client.query("ROLLBACK");
      return notFound(res, "Product not found.");
    }
    const inserted = await client.query(
      `INSERT INTO product_variants
         (product_id, sku, name, unit_label, unit_quantity, price, compare_at_price, is_default, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
       RETURNING id, product_id, sku, name, unit_label, unit_quantity, price, compare_at_price, is_default, is_active`,
      [productId, variant.sku, variant.name, variant.unitLabel, variant.unitQuantity,
        variant.price, variant.compareAtPrice, variant.isActive]
    );
    await client.query("INSERT INTO inventory (variant_id, quantity_on_hand) VALUES ($1, 0)", [inserted.rows[0].id]);
    await writeAuditLog(client, req, "partner.variant.created", "product_variants", inserted.rows[0].id, null, inserted.rows[0]);
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: inserted.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    const knownError = validationError(error);
    if (knownError) return res.status(knownError.status).json({ success: false, message: knownError.message, data: null });
    console.error("Partner variant creation failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to create variant.", data: null });
  } finally {
    client?.release();
  }
}

async function updatePartnerVariant(req, res) {
  const { shopId, productId, variantId } = req.params;
  if (![shopId, productId, variantId].every(validUuid)) return badRequest(res, "Invalid shop, product, or variant id.");
  const allowedFields = new Set(["name", "unit_label", "price", "unit_quantity", "compare_at_price", "sku", "is_active"]);
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)
      || !Object.keys(req.body).length || Object.keys(req.body).some(field => !allowedFields.has(field))) {
    return badRequest(res, "Provide supported variant fields.");
  }
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await client.query(
      `SELECT pv.* FROM product_variants pv
       JOIN products p ON p.id = pv.product_id JOIN shops s ON s.id = p.shop_id
       WHERE pv.id = $1 AND pv.product_id = $2 AND p.shop_id = $3
         AND s.partner_id = ANY($4::uuid[]) AND pv.deleted_at IS NULL
         AND p.deleted_at IS NULL AND s.deleted_at IS NULL
       FOR UPDATE OF pv`,
      [variantId, productId, shopId, req.partnerIds]
    );
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return notFound(res, "Variant not found.");
    }
    const next = { ...before.rows[0] };
    for (const [field, value] of Object.entries(req.body)) {
      if (field === "name" || field === "unit_label") {
        const maxLength = field === "name" ? 200 : 100;
        if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
          await client.query("ROLLBACK");
          return badRequest(res, `${field} is invalid.`);
        }
        next[field] = value.trim();
      } else if (field === "sku") {
        if (value !== null && (typeof value !== "string" || value.trim().length > 200)) {
          await client.query("ROLLBACK");
          return badRequest(res, "sku is invalid.");
        }
        next.sku = value == null || !value.trim() ? null : value.trim();
      } else if (field === "price" || field === "unit_quantity" || field === "compare_at_price") {
        if (value === null && field === "compare_at_price") next[field] = null;
        else {
          const number = Number(value);
          const minimum = field === "unit_quantity" ? 0.001 : 0;
          const maximum = field === "unit_quantity" ? 999999999.999 : 9999999999.99;
          if (!Number.isFinite(number) || number < minimum || number > maximum) {
            await client.query("ROLLBACK");
            return badRequest(res, `${field} is invalid.`);
          }
          next[field] = number;
        }
      } else {
        if (typeof value !== "boolean") {
          await client.query("ROLLBACK");
          return badRequest(res, "is_active must be a boolean.");
        }
        next.is_active = value;
      }
    }
    if (next.compare_at_price != null && Number(next.compare_at_price) < Number(next.price)) {
      await client.query("ROLLBACK");
      return badRequest(res, "compare_at_price cannot be below price.");
    }
    const columns = Object.keys(req.body);
    const values = [variantId];
    const assignments = columns.map(column => {
      values.push(next[column]);
      return `${column} = $${values.length}`;
    });
    assignments.push("updated_at = now()");
    const updated = await client.query(
      `UPDATE product_variants SET ${assignments.join(", ")} WHERE id = $1 RETURNING *`,
      values
    );
    await writeAuditLog(client, req, "partner.variant.updated", "product_variants", variantId, before.rows[0], updated.rows[0]);
    await client.query("COMMIT");
    return res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    const knownError = validationError(error);
    if (knownError) return res.status(knownError.status).json({ success: false, message: knownError.message, data: null });
    console.error("Partner variant update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update variant.", data: null });
  } finally {
    client?.release();
  }
}

async function updatePartnerInventory(req, res) {
  const { shopId, variantId } = req.params;
  if (!validUuid(shopId) || !validUuid(variantId)) return badRequest(res, "Invalid shop or variant id.");
  const quantityOnHand = req.body?.quantity_on_hand;
  const lowStockThreshold = req.body?.low_stock_threshold;
  const isActive = req.body?.is_active;
  const hasQuantity = quantityOnHand != null;
  const hasThreshold = lowStockThreshold != null;
  const hasAvailability = isActive != null;

  if ((!hasQuantity && !hasThreshold && !hasAvailability)
      || (hasQuantity && (!Number.isFinite(Number(quantityOnHand)) || Number(quantityOnHand) < 0 || Number(quantityOnHand) > 999999999.999))
      || (hasThreshold && (!Number.isFinite(Number(lowStockThreshold)) || Number(lowStockThreshold) < 0 || Number(lowStockThreshold) > 999999999.999))
      || (hasAvailability && typeof isActive !== "boolean")) {
    return badRequest(res, "Provide a non-negative stock quantity/threshold or a boolean is_active value.");
  }

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const ownedResult = await client.query(
      `SELECT pv.id, pv.is_active,
              COALESCE(i.quantity_on_hand, 0) AS quantity_on_hand,
              COALESCE(i.quantity_reserved, 0) AS quantity_reserved,
              COALESCE(i.low_stock_threshold, 0) AS low_stock_threshold
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       JOIN shops s ON s.id = p.shop_id
       LEFT JOIN inventory i ON i.variant_id = pv.id
       WHERE pv.id = $1 AND p.shop_id = $2
         AND s.partner_id = ANY($3::uuid[])
         AND pv.deleted_at IS NULL AND p.deleted_at IS NULL AND s.deleted_at IS NULL
       FOR UPDATE OF pv`,
      [variantId, shopId, req.partnerIds]
    );
    const owned = ownedResult.rows[0];
    if (!owned) {
      await client.query("ROLLBACK");
      return notFound(res, "Inventory item not found.");
    }

    const nextQuantity = hasQuantity ? Number(quantityOnHand) : Number(owned.quantity_on_hand);
    if (nextQuantity < Number(owned.quantity_reserved)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Quantity cannot be lower than reserved stock.", data: null });
    }
    const nextThreshold = hasThreshold ? Number(lowStockThreshold) : Number(owned.low_stock_threshold);
    const inventoryResult = await client.query(
      `INSERT INTO inventory (variant_id, quantity_on_hand, low_stock_threshold)
       VALUES ($1, $2, $3)
       ON CONFLICT (variant_id) DO UPDATE
       SET quantity_on_hand = EXCLUDED.quantity_on_hand,
           low_stock_threshold = EXCLUDED.low_stock_threshold,
           updated_at = now()
       RETURNING variant_id, quantity_on_hand, quantity_reserved, low_stock_threshold, updated_at`,
      [variantId, nextQuantity, nextThreshold]
    );
    if (hasAvailability) {
      await client.query(
        `UPDATE product_variants pv
         SET is_active = $2, updated_at = now()
         FROM products p JOIN shops s ON s.id = p.shop_id
         WHERE pv.id = $1 AND pv.product_id = p.id AND p.shop_id = $3
           AND s.partner_id = ANY($4::uuid[])`,
        [variantId, isActive, shopId, req.partnerIds]
      );
    }
    await writeAuditLog(
      client,
      req,
      "partner.inventory.adjusted",
      "inventory",
      variantId,
      {
        quantity_on_hand: Number(owned.quantity_on_hand),
        low_stock_threshold: Number(owned.low_stock_threshold),
        is_active: owned.is_active
      },
      { ...inventoryResult.rows[0], is_active: hasAvailability ? isActive : owned.is_active }
    );
    await client.query("COMMIT");
    return res.json({
      success: true,
      data: { ...inventoryResult.rows[0], is_active: hasAvailability ? isActive : owned.is_active }
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    const knownError = validationError(error);
    if (knownError) return res.status(knownError.status).json({ success: false, message: knownError.message, data: null });
    console.error("Partner inventory update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update partner inventory.", data: null });
  } finally {
    client?.release();
  }
}

module.exports = {
  updatePartnerShop,
  updatePartnerShopStatus,
  createPartnerProduct,
  updatePartnerProduct,
  deactivatePartnerProduct,
  updatePartnerProductStatus,
  createPartnerVariant,
  updatePartnerVariant,
  updatePartnerInventory
};
