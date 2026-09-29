"use strict";

const db = require("../config/db");

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
      || !Number.isFinite(price) || price < 0
      || !Number.isFinite(unitQuantity) || unitQuantity <= 0
      || (compareAtPrice != null && (!Number.isFinite(compareAtPrice) || compareAtPrice < price))
      || (sku != null && sku.length > 200)
      || typeof isActive !== "boolean") return null;

  return { name, unitLabel, price, unitQuantity, compareAtPrice, sku, isActive };
}

function normalizeImageUrl(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 80000) return undefined;
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;

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
  if (error.code === "23514" || error.code === "22P02") return { status: 400, message: "The supplied values are not valid." };
  return null;
}

function validateProductBody(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = body?.description == null || body.description === "" ? null : body.description;
  const brand = body?.brand == null || body.brand === "" ? null : body.brand;
  const categoryId = body?.category_id || null;
  const variant = normalizeVariant(body?.variant);
  const imageUrl = normalizeImageUrl(body?.image_url);

  if (!name || name.length > 300 || (description != null && typeof description !== "string")
      || (brand != null && typeof brand !== "string")
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

async function updatePartnerShop(req, res) {
  const { shopId } = req.params;
  if (!validUuid(shopId)) return badRequest(res, "Invalid shop id.");

  const updates = [];
  const values = [shopId, req.partnerIds];
  for (const [field, column] of [["name", "name"], ["address_line1", "address_line1"]]) {
    if (req.body?.[field] === undefined) continue;
    if (typeof req.body[field] !== "string" || !req.body[field].trim()) {
      return badRequest(res, `${field} must be a non-empty string.`);
    }
    values.push(req.body[field].trim());
    updates.push(`${column} = $${values.length}`);
  }
  if (!updates.length) return badRequest(res, "At least one supported shop field is required.");

  try {
    const result = await db.query(
      `UPDATE shops s
       SET ${updates.join(", ")}, updated_at = now()
       WHERE s.id = $1 AND s.partner_id = ANY($2::uuid[]) AND s.deleted_at IS NULL
       RETURNING s.id, s.partner_id, s.name, s.address_line1, s.status, s.updated_at`,
      values
    );
    if (!result.rows[0]) return notFound(res);
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Partner shop update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update partner shop.", data: null });
  }
}

async function updatePartnerShopStatus(req, res) {
  const { shopId } = req.params;
  if (!validUuid(shopId)) return badRequest(res, "Invalid shop id.");
  const { status } = req.body || {};
  if (!["ACTIVE", "PAUSED"].includes(status)) return badRequest(res, "status must be ACTIVE or PAUSED.");

  try {
    const shopResult = await db.query(
      `SELECT id, partner_id FROM shops
       WHERE id = $1 AND partner_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [shopId, req.partnerIds]
    );
    const shop = shopResult.rows[0];
    if (!shop) return notFound(res);
    const membership = req.partnerMemberships.find(item => item.partner_id === shop.partner_id);
    if (!membership || !["OWNER", "MANAGER"].includes(membership.member_role)) {
      return res.status(403).json({ success: false, message: "Partner owner or manager access required." });
    }

    const result = await db.query(
      `UPDATE shops
       SET status = $3, updated_at = now()
       WHERE id = $1 AND partner_id = ANY($2::uuid[])
         AND status IN ('ACTIVE', 'PAUSED') AND deleted_at IS NULL
       RETURNING id, partner_id, name, status, updated_at`,
      [shopId, req.partnerIds, status]
    );
    if (!result.rows[0]) return notFound(res);
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Partner shop status update failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to update shop status.", data: null });
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
      `SELECT p.id FROM products p
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
       SET category_id = $3, name = $4, description = $5, brand = $6, status = 'ACTIVE', updated_at = now()
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

  try {
    const result = await db.query(
      `UPDATE products p
       SET status = 'PAUSED', updated_at = now()
       FROM shops s
       WHERE p.id = $1 AND p.shop_id = $2 AND s.id = p.shop_id
         AND s.partner_id = ANY($3::uuid[])
         AND p.deleted_at IS NULL AND s.deleted_at IS NULL
       RETURNING p.id, p.shop_id, p.status`,
      [productId, shopId, req.partnerIds]
    );
    if (!result.rows[0]) return notFound(res, "Product not found.");
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Partner product deactivation failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to deactivate partner product.", data: null });
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
      || (hasQuantity && (!Number.isFinite(Number(quantityOnHand)) || Number(quantityOnHand) < 0))
      || (hasThreshold && (!Number.isFinite(Number(lowStockThreshold)) || Number(lowStockThreshold) < 0))
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
  updatePartnerInventory
};
