const db = require("../config/db");

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value) {
  return typeof value === "string" && uuidPattern.test(value);
}

function invalidUuidResponse(res) {
  return res.status(400).json({
    success: false,
    message: "Invalid shop id",
    data: null
  });
}

async function listShops(req, res) {
  try {
    const result = await db.query(
      `SELECT id, partner_id, name, description, cuisine, image_object_key
       FROM shops
       WHERE status = 'ACTIVE' AND deleted_at IS NULL
       ORDER BY name ASC`
    );

    return res.json({
      success: true,
      message: "Shops retrieved successfully",
      data: result.rows
    });
  } catch (error) {
    console.error("Shop listing failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve shops",
      data: null
    });
  }
}

async function getShop(req, res) {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    return invalidUuidResponse(res);
  }

  try {
    const result = await db.query(
      `SELECT id, partner_id, name, description, cuisine, image_object_key
       FROM shops
       WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
        data: null
      });
    }

    return res.json({
      success: true,
      message: "Shop retrieved successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Shop retrieval failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve shop",
      data: null
    });
  }
}

async function listShopProducts(req, res) {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    return invalidUuidResponse(res);
  }

  try {
    const shopResult = await db.query(
      `SELECT id
       FROM shops
       WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
      [id]
    );

    if (shopResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
        data: null
      });
    }

    const productResult = await db.query(
      `SELECT
         p.id,
         p.name,
         p.description,
         p.brand,
         CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
           'id', c.id,
           'name', c.name,
           'slug', c.slug,
           'description', c.description
         ) END AS category,
         COALESCE(variants.items, '[]'::jsonb) AS variants,
         COALESCE(images.items, '[]'::jsonb) AS images
       FROM products p
       LEFT JOIN categories c
         ON c.id = p.category_id
        AND c.is_active = true
        AND c.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'id', pv.id,
             'name', pv.name,
             'unit_label', pv.unit_label,
             'unit_quantity', pv.unit_quantity,
             'price', pv.price,
             'compare_at_price', pv.compare_at_price,
             'is_default', pv.is_default
           ) ORDER BY pv.is_default DESC, pv.name ASC
         ) AS items
         FROM product_variants pv
         WHERE pv.product_id = p.id
           AND pv.is_active = true
           AND pv.deleted_at IS NULL
       ) variants ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'public_url', pi.public_url,
             'alt_text', pi.alt_text,
             'sort_order', pi.sort_order
           ) ORDER BY pi.sort_order ASC, pi.id ASC
         ) AS items
         FROM product_images pi
         WHERE pi.product_id = p.id
       ) images ON true
       WHERE p.shop_id = $1
         AND p.status = 'ACTIVE'
         AND p.deleted_at IS NULL
       ORDER BY p.name ASC`,
      [id]
    );

    return res.json({
      success: true,
      message: "Shop products retrieved successfully",
      data: productResult.rows
    });
  } catch (error) {
    console.error("Shop products retrieval failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve shop products",
      data: null
    });
  }
}

module.exports = { listShops, getShop, listShopProducts };