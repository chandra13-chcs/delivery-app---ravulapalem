const db = require("../config/db");

const categorySlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS_TYPES = new Set(["RESTAURANT", "GROCERY", "MEAT", "OTHER", "LOCAL_STORE"]);

function normalizeBusinessType(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/-/g, "_");
  if (normalized === "LOCAL_STORE" || normalized === "LOCALSTORE") return "OTHER";
  if (normalized === "OTHER") return "OTHER";
  if (BUSINESS_TYPES.has(normalized)) return normalized;
  return null;
}

async function listProductsByCategory(req, res) {
  const suppliedCategory = typeof req.query.category === "string" ? req.query.category.trim() : "";
  const categorySlug = suppliedCategory ? suppliedCategory.toLowerCase() : "";
  const requestedBusinessType = normalizeBusinessType(req.query.business_type);

  if (categorySlug && !categorySlugPattern.test(categorySlug) && !uuidPattern.test(categorySlug)) {
    return res.status(400).json({
      success: false,
      message: "A valid category slug or category id is required",
      data: null
    });
  }
  if (req.query.business_type && !requestedBusinessType) {
    return res.status(400).json({
      success: false,
      message: "A supported business_type is required",
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
         variant.id AS variant_id,
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
        AND (c.business_type IS NULL OR c.business_type = partner.business_type)
       LEFT JOIN LATERAL (
         SELECT pv.id, pv.price, pv.unit_label, pv.unit_quantity
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
         AND ($1::text IS NULL OR c.slug = $1 OR c.id::text = $1)
         AND ($2::text IS NULL OR partner.business_type = $2)
       ORDER BY p.name ASC`,
      [categorySlug || null, requestedBusinessType]
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
