const db = require("../config/db");

const categorySlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function listProductsByCategory(req, res) {
  const categorySlug = typeof req.query.category === "string"
    ? req.query.category.trim().toLowerCase()
    : "";

  if (!categorySlugPattern.test(categorySlug)) {
    return res.status(400).json({
      success: false,
      message: "A valid category slug is required",
      data: null
    });
  }

  try {
    const result = await db.query(
      `SELECT
         p.id,
         p.shop_id,
         p.name,
         p.description,
         p.brand,
         c.name AS category_name,
         c.slug AS category_slug,
         COALESCE(variant.price, 0) AS price,
         variant.unit_label,
         variant.unit_quantity,
         image.public_url AS image_url,
         s.name AS shop_name
       FROM products p
       JOIN categories c
         ON c.id = p.category_id
        AND c.is_active = true
        AND c.deleted_at IS NULL
       JOIN shops s
         ON s.id = p.shop_id
        AND s.status = 'ACTIVE'
        AND s.deleted_at IS NULL
       JOIN partners partner
         ON partner.id = s.partner_id
        AND partner.status = 'ACTIVE'
        AND partner.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT pv.price, pv.unit_label, pv.unit_quantity
         FROM product_variants pv
         WHERE pv.product_id = p.id
           AND pv.is_active = true
           AND pv.deleted_at IS NULL
         ORDER BY pv.is_default DESC, pv.name ASC
         LIMIT 1
       ) variant ON true
       LEFT JOIN LATERAL (
         SELECT pi.public_url
         FROM product_images pi
         WHERE pi.product_id = p.id
         ORDER BY pi.sort_order ASC, pi.id ASC
         LIMIT 1
       ) image ON true
       WHERE p.status = 'ACTIVE'
         AND p.deleted_at IS NULL
         AND c.slug = $1
       ORDER BY p.name ASC`,
      [categorySlug]
    );

    return res.json({
      success: true,
      message: "Category products retrieved successfully",
      data: result.rows
    });
  } catch (error) {
    console.error("Category products retrieval failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve category products",
      data: null
    });
  }
}

module.exports = { listProductsByCategory };
