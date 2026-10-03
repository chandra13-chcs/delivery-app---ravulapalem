const db = require("../config/db");

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value) {
  return typeof value === "string" && uuidPattern.test(value);
}

function invalidIdResponse(res) {
  return res.status(400).json({ success: false, message: "Invalid shop id.", data: null });
}

function notFoundResponse(res) {
  return res.status(404).json({ success: false, message: "Shop not found.", data: null });
}

async function findPartnerShop(shopId, partnerIds) {
  const result = await db.query(
    `SELECT s.id, s.partner_id
     FROM shops s
     WHERE s.id = $1
       AND s.partner_id = ANY($2::uuid[])
       AND s.deleted_at IS NULL`,
    [shopId, partnerIds]
  );
  return result.rows[0] || null;
}

async function getPartnerProfile(req, res) {
  return res.json({
    success: true,
    data: {
      user: req.user,
      partners: req.partnerMemberships
    }
  });
}

async function listPartnerShops(req, res) {
  const partnerId = typeof req.query.partner_id === "string" ? req.query.partner_id : null;
  if (partnerId && !isValidUuid(partnerId)) {
    return res.status(400).json({ success: false, message: "Invalid partner id.", data: null });
  }
  if (partnerId && !req.partnerIds.includes(partnerId)) return notFoundResponse(res);

  try {
    const result = await db.query(
      `SELECT s.id, s.partner_id, p.display_name AS partner_name, p.business_type,
              s.name, s.description, s.cuisine, s.image_object_key,
              s.phone_e164, s.email, s.address_line1, s.address_line2, s.locality,
              s.city, s.state, s.postal_code, s.country_code, s.latitude, s.longitude,
              s.status, s.created_at, s.updated_at
       FROM shops s
       JOIN partners p ON p.id = s.partner_id
       WHERE s.partner_id = ANY($1::uuid[])
         AND ($2::uuid IS NULL OR s.partner_id = $2)
         AND s.deleted_at IS NULL
       ORDER BY p.display_name ASC, s.name ASC`,
      [req.partnerIds, partnerId]
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Partner shop listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve partner shops.", data: null });
  }
}

async function listPartnerCategories(req, res) {
  const shopId = typeof req.query.shop_id === "string" ? req.query.shop_id : "";
  if (!isValidUuid(shopId)) {
    return res.status(400).json({ success: false, message: "A valid shop_id is required.", data: null });
  }

  try {
    const shopResult = await db.query(
      `SELECT p.business_type
       FROM shops s
       JOIN partners p ON p.id = s.partner_id
       WHERE s.id = $1
         AND s.partner_id = ANY($2::uuid[])
         AND s.deleted_at IS NULL
         AND p.deleted_at IS NULL`,
      [shopId, req.partnerIds]
    );
    if (!shopResult.rows[0]) return notFoundResponse(res);

    const result = await db.query(
      `SELECT id, name, slug, description, parent_id, business_type, sort_order
       FROM categories
       WHERE is_active = true
         AND deleted_at IS NULL
         AND (business_type IS NULL OR business_type = $1)
       ORDER BY sort_order ASC, name ASC`,
      [shopResult.rows[0].business_type]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Partner category listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve partner categories.", data: null });
  }
}

async function getPartnerShop(req, res) {
  const { shopId } = req.params;
  if (!isValidUuid(shopId)) return invalidIdResponse(res);

  try {
    const shop = await findPartnerShop(shopId, req.partnerIds);
    if (!shop) return notFoundResponse(res);

    const result = await db.query(
      `SELECT s.id, s.partner_id, p.display_name AS partner_name, p.business_type,
              s.name, s.description, s.cuisine, s.image_object_key,
              s.phone_e164, s.email, s.address_line1, s.address_line2, s.locality,
              s.city, s.state, s.postal_code, s.country_code, s.latitude, s.longitude,
              s.status, s.created_at, s.updated_at
       FROM shops s
       JOIN partners p ON p.id = s.partner_id
       WHERE s.id = $1
         AND s.partner_id = ANY($2::uuid[])
         AND s.deleted_at IS NULL`,
      [shopId, req.partnerIds]
    );
    if (!result.rows[0]) return notFoundResponse(res);
    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Partner shop retrieval failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve partner shop.", data: null });
  }
}

async function getPartnerShopDashboard(req, res) {
  const { shopId } = req.params;
  if (!isValidUuid(shopId)) return invalidIdResponse(res);
  try {
    const result = await db.query(
      `SELECT s.id AS shop_id, s.partner_id, p.display_name AS partner_name,
              s.name AS shop_name, s.status AS shop_status,
              (SELECT count(*) FROM products pr
               WHERE pr.shop_id = s.id AND pr.deleted_at IS NULL)::int AS total_products,
              (SELECT count(*) FROM products pr
               WHERE pr.shop_id = s.id AND pr.status = 'ACTIVE' AND pr.deleted_at IS NULL)::int AS active_products,
              (SELECT COALESCE(sum(i.quantity_on_hand), 0)
               FROM products pr JOIN product_variants pv ON pv.product_id = pr.id AND pv.deleted_at IS NULL
               JOIN inventory i ON i.variant_id = pv.id
               WHERE pr.shop_id = s.id AND pr.deleted_at IS NULL) AS stock_quantity,
              (SELECT count(DISTINCT o.id) FROM order_fulfillments f JOIN orders o ON o.id = f.order_id
               WHERE f.shop_id = s.id AND f.status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKING_UP'))::int AS pending_orders,
              (SELECT count(DISTINCT o.id) FROM order_fulfillments f JOIN orders o ON o.id = f.order_id
               WHERE f.shop_id = s.id AND o.status = 'DELIVERED')::int AS completed_orders,
              (SELECT count(DISTINCT o.id) FROM order_fulfillments f JOIN orders o ON o.id = f.order_id
               WHERE f.shop_id = s.id AND o.status IN ('CANCELLED', 'REJECTED'))::int AS cancelled_orders,
                (SELECT COALESCE(sum(oi.line_total), 0)
                 FROM order_fulfillments f JOIN orders o ON o.id = f.order_id
                 JOIN order_items oi ON oi.fulfillment_id = f.id
                 WHERE f.shop_id = s.id AND o.status = 'DELIVERED') AS delivered_item_value
       FROM shops s JOIN partners p ON p.id = s.partner_id
       WHERE s.id = $1 AND s.partner_id = ANY($2::uuid[])
         AND s.deleted_at IS NULL AND p.status = 'ACTIVE' AND p.deleted_at IS NULL`,
      [shopId, req.partnerIds]
    );
    if (!result.rows[0]) return notFoundResponse(res);
    const row = result.rows[0];
    return res.json({
      success: true,
      data: {
        ...row,
        stock_quantity: Number(row.stock_quantity),
        delivered_item_value: Number(row.delivered_item_value)
      }
    });
  } catch (error) {
    console.error("Partner dashboard retrieval failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve shop dashboard.", data: null });
  }
}

async function listPartnerShopProducts(req, res) {
  const { shopId } = req.params;
  if (!isValidUuid(shopId)) return invalidIdResponse(res);

  try {
    const shop = await findPartnerShop(shopId, req.partnerIds);
    if (!shop) return notFoundResponse(res);

    const result = await db.query(
      `SELECT p.id, p.shop_id, p.category_id, p.name, p.description, p.brand,
              p.status, p.created_at, p.updated_at,
              COALESCE(variants.items, '[]'::jsonb) AS variants,
              COALESCE(images.items, '[]'::jsonb) AS images
       FROM products p
       JOIN shops s ON s.id = p.shop_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'id', pv.id,
             'sku', pv.sku,
             'name', pv.name,
             'unit_label', pv.unit_label,
             'unit_quantity', pv.unit_quantity,
             'price', pv.price,
             'compare_at_price', pv.compare_at_price,
             'is_default', pv.is_default,
             'is_active', pv.is_active,
             'quantity_on_hand', COALESCE(i.quantity_on_hand, 0),
             'quantity_reserved', COALESCE(i.quantity_reserved, 0),
             'low_stock_threshold', COALESCE(i.low_stock_threshold, 0),
             'inventory_updated_at', i.updated_at
           ) ORDER BY pv.is_default DESC, pv.name ASC
         ) AS items
         FROM product_variants pv
         LEFT JOIN inventory i ON i.variant_id = pv.id
         WHERE pv.product_id = p.id AND pv.deleted_at IS NULL
       ) variants ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object('public_url', pi.public_url, 'alt_text', pi.alt_text, 'sort_order', pi.sort_order)
           ORDER BY pi.sort_order ASC, pi.id ASC
         ) AS items
         FROM product_images pi
         WHERE pi.product_id = p.id
       ) images ON true
       WHERE p.shop_id = $1
         AND s.partner_id = ANY($2::uuid[])
         AND s.deleted_at IS NULL
         AND p.deleted_at IS NULL
       ORDER BY p.name ASC`,
      [shopId, req.partnerIds]
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Partner product listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve partner products.", data: null });
  }
}

async function listPartnerShopInventory(req, res) {
  const { shopId } = req.params;
  if (!isValidUuid(shopId)) return invalidIdResponse(res);

  try {
    const shop = await findPartnerShop(shopId, req.partnerIds);
    if (!shop) return notFoundResponse(res);

    const result = await db.query(
      `SELECT p.id AS product_id, p.name AS product_name,
              pv.id AS variant_id, pv.sku, pv.name AS variant_name,
              pv.unit_label, pv.unit_quantity, pv.price,
              COALESCE(i.quantity_on_hand, 0) AS quantity_on_hand,
              COALESCE(i.quantity_reserved, 0) AS quantity_reserved,
              COALESCE(i.low_stock_threshold, 0) AS low_stock_threshold,
              i.updated_at AS inventory_updated_at
       FROM products p
       JOIN shops s ON s.id = p.shop_id
       JOIN product_variants pv ON pv.product_id = p.id AND pv.deleted_at IS NULL
       LEFT JOIN inventory i ON i.variant_id = pv.id
       WHERE p.shop_id = $1
         AND s.partner_id = ANY($2::uuid[])
         AND s.deleted_at IS NULL
         AND p.deleted_at IS NULL
       ORDER BY p.name ASC, pv.is_default DESC, pv.name ASC`,
      [shopId, req.partnerIds]
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Partner inventory listing failed:", error.message);
    return res.status(500).json({ success: false, message: "Unable to retrieve partner inventory.", data: null });
  }
}

module.exports = {
  getPartnerProfile,
  listPartnerShops,
  listPartnerCategories,
  getPartnerShop,
  getPartnerShopDashboard,
  listPartnerShopProducts,
  listPartnerShopInventory
};