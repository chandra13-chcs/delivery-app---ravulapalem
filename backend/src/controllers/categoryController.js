const db = require("../config/db");
const { writeAuditLog } = require("../services/auditService");

const CATEGORY_COLUMNS = `id, name, slug, description, parent_id, business_type, sort_order,
                         is_active, created_at, updated_at, deleted_at`;
const CATEGORY_FIELDS = new Set(["name", "slug", "description", "parent_id", "business_type", "sort_order", "is_active"]);
const BUSINESS_TYPES = new Set(["RESTAURANT", "GROCERY", "MEAT", "OTHER", "LOCAL_STORE"]);
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function normalizeBusinessType(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/-/g, "_");
  if (normalized === "LOCAL_STORE" || normalized === "LOCALSTORE") return "OTHER";
  if (BUSINESS_TYPES.has(normalized)) return normalized;
  return null;
}
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 60;
const MAX_SLUG_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;
const MIN_POSTGRES_INTEGER = -2147483648;
const MAX_POSTGRES_INTEGER = 2147483647;

function responseError(res, status, message) {
  return res.status(status).json({ success: false, message, data: null });
}

function slugFromName(name) {
  return name.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

function validateCategoryBody(body, creating) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "A JSON object is required." };

  const suppliedFields = Object.keys(body);
  if (suppliedFields.some(field => !CATEGORY_FIELDS.has(field))) return { error: "Unsupported category field." };
  if (creating && !Object.prototype.hasOwnProperty.call(body, "name")) return { error: "Category name is required." };
  if (!creating && suppliedFields.length === 0) return { error: "At least one category field is required." };

  const value = {};
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > MAX_NAME_LENGTH) {
      return { error: `Category name must be between 1 and ${MAX_NAME_LENGTH} characters.` };
    }
    value.name = body.name.trim();
  }

  if (creating || Object.prototype.hasOwnProperty.call(body, "slug")) {
    const slug = Object.prototype.hasOwnProperty.call(body, "slug")
      ? body.slug
      : slugFromName(value.name);
    if (typeof slug !== "string" || slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
      return { error: "Category slug must contain lowercase letters, numbers, and single hyphens only." };
    }
    value.slug = slug;
  }

  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    if (body.description !== null && (typeof body.description !== "string" || body.description.length > MAX_DESCRIPTION_LENGTH)) {
      return { error: `Category description must be null or at most ${MAX_DESCRIPTION_LENGTH} characters.` };
    }
    value.description = body.description;
  } else if (creating) {
    value.description = null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "parent_id")) {
    if (body.parent_id !== null && (typeof body.parent_id !== "string" || !UUID_PATTERN.test(body.parent_id))) {
      return { error: "Parent category ID must be a valid UUID or null." };
    }
    value.parent_id = body.parent_id === null ? null : body.parent_id.toLowerCase();
  } else if (creating) {
    value.parent_id = null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "business_type")) {
    const normalizedBusinessType = normalizeBusinessType(body.business_type);
    if (body.business_type !== null && !normalizedBusinessType) {
      return { error: "business_type must be a supported business type or null." };
    }
    value.business_type = body.business_type === null ? null : normalizedBusinessType;
  } else if (creating) {
    value.business_type = null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "sort_order")) {
    if (!Number.isInteger(body.sort_order) || body.sort_order < MIN_POSTGRES_INTEGER || body.sort_order > MAX_POSTGRES_INTEGER) {
      return { error: "Category sort_order must be a valid PostgreSQL integer." };
    }
    value.sort_order = body.sort_order;
  } else if (creating) {
    value.sort_order = 0;
  }

  if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
    if (typeof body.is_active !== "boolean") return { error: "Category is_active must be a boolean." };
    value.is_active = body.is_active;
  } else if (creating) {
    value.is_active = true;
  }

  return { value };
}

function isDuplicateSlug(error) {
  return error.code === "23505" && (!error.constraint || error.constraint.includes("slug"));
}

async function getCategoryParent(queryable, parentId) {
  if (parentId === null) return null;
  const result = await queryable.query(
    "SELECT id, business_type FROM categories WHERE id = $1 AND deleted_at IS NULL",
    [parentId]
  );
  return result.rows[0] || null;
}

async function categoryParentScopeIsCompatible(queryable, parentId, businessType) {
  const parent = await getCategoryParent(queryable, parentId);
  if (parentId !== null && !parent) return { error: "Parent category does not exist." };
  if (parent?.business_type && parent.business_type !== businessType) {
    return { error: "Child category business_type must match its parent category." };
  }
  return {};
}

async function categoryChildrenMatchScope(queryable, categoryId, businessType) {
  if (businessType === null) return true;
  const children = await queryable.query(
    `SELECT 1
     FROM categories
     WHERE parent_id = $1
       AND deleted_at IS NULL
       AND business_type IS DISTINCT FROM $2
     LIMIT 1`,
    [categoryId, businessType]
  );
  return children.rows.length === 0;
}

async function parentWouldCreateCycle(queryable, categoryId, parentId) {
  const result = await queryable.query(
    `WITH RECURSIVE descendants(id) AS (
       SELECT id FROM categories WHERE id = $1::uuid AND deleted_at IS NULL
       UNION
       SELECT child.id
       FROM categories child
       JOIN descendants parent ON child.parent_id = parent.id
       WHERE child.deleted_at IS NULL
     )
     SELECT EXISTS (SELECT 1 FROM descendants WHERE id = $2::uuid) AS would_create_cycle`,
    [categoryId, parentId]
  );
  return result.rows[0]?.would_create_cycle === true;
}

async function listAdminCategories(req, res) {
  try {
    const result = await db.query(
      `SELECT ${CATEGORY_COLUMNS} FROM categories ORDER BY sort_order ASC, name ASC, id ASC`
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Admin category listing failed:", error.message);
    return responseError(res, 500, "Unable to retrieve categories.");
  }
}

async function listCategories(req, res) {
  const requestedBusinessType = typeof req.query.business_type === "string"
    ? req.query.business_type.trim().toUpperCase()
    : null;
  const normalizedBusinessType = normalizeBusinessType(requestedBusinessType);
  if (requestedBusinessType && !normalizedBusinessType) {
    return responseError(res, 400, "business_type must be a supported business type.");
  }

  try {
    const result = await db.query(
      `SELECT id, name, slug, description, parent_id, business_type, sort_order
       FROM categories
       WHERE is_active = true
         AND deleted_at IS NULL
         AND (
           ($1::text IS NULL AND business_type IS NULL)
           OR ($1::text IS NOT NULL AND (business_type IS NULL OR business_type = $1))
         )
         ORDER BY sort_order ASC, name ASC`,
      [normalizedBusinessType]
    );

    return res.json({
      success: true,
      message: "Categories retrieved successfully",
      data: result.rows
    });
  } catch (error) {
    console.error("Category listing failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve categories",
      data: null
    });
  }
}

async function createCategory(req, res) {
  const validation = validateCategoryBody(req.body, true);
  if (validation.error) return responseError(res, 400, validation.error);

  const category = validation.value;
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const parentScope = await categoryParentScopeIsCompatible(client, category.parent_id, category.business_type);
    if (parentScope.error) {
      await client.query("ROLLBACK");
      return responseError(res, 400, parentScope.error);
    }

    const result = await client.query(
      `INSERT INTO categories (name, slug, description, parent_id, business_type, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${CATEGORY_COLUMNS}`,
      [category.name, category.slug, category.description, category.parent_id, category.business_type,
        category.sort_order, category.is_active]
    );
    await writeAuditLog(client, req, "category.created", "categories", result.rows[0].id, null, result.rows[0]);
    await client.query("COMMIT");
    return res.status(201).json({ success: true, message: "Category created successfully.", data: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (isDuplicateSlug(error)) return responseError(res, 409, "Category slug already exists.");
    if (error.code === "23503") return responseError(res, 400, "Parent category does not exist.");
    console.error("Category creation failed:", error.message);
    return responseError(res, 500, "Unable to create category.");
  } finally {
    client?.release();
  }
}

async function updateCategory(req, res) {
  if (typeof req.params.id !== "string" || !UUID_PATTERN.test(req.params.id)) {
    return responseError(res, 400, "Category ID must be a valid UUID.");
  }

  const validation = validateCategoryBody(req.body, false);
  if (validation.error) return responseError(res, 400, validation.error);

  const category = validation.value;
  const categoryId = req.params.id.toLowerCase();
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const existingCategory = await client.query(
      "SELECT * FROM categories WHERE id = $1::uuid FOR UPDATE",
      [categoryId]
    );
    if (!existingCategory.rows[0]) {
      await client.query("ROLLBACK");
      return responseError(res, 404, "Category not found.");
    }

    const nextParentId = Object.prototype.hasOwnProperty.call(category, "parent_id")
      ? category.parent_id
      : existingCategory.rows[0].parent_id;
    const nextBusinessType = Object.prototype.hasOwnProperty.call(category, "business_type")
      ? category.business_type
      : existingCategory.rows[0].business_type;
    const parentScope = await categoryParentScopeIsCompatible(client, nextParentId, nextBusinessType);
    if (parentScope.error) {
      await client.query("ROLLBACK");
      return responseError(res, 400, parentScope.error);
    }
    if (nextParentId && await parentWouldCreateCycle(client, categoryId, nextParentId)) {
      await client.query("ROLLBACK");
      return responseError(res, 400, "A category cannot be its own parent or a descendant of itself.");
    }
    if (!await categoryChildrenMatchScope(client, categoryId, nextBusinessType)) {
      await client.query("ROLLBACK");
      return responseError(res, 400, "Category business_type must remain compatible with its child categories.");
    }

    const values = [categoryId];
    const assignments = [];
    for (const field of CATEGORY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(category, field)) {
        values.push(category[field]);
        assignments.push(`${field} = $${values.length}`);
      }
    }
    const isRestoring = existingCategory.rows[0].deleted_at && category.is_active === true;
    if (isRestoring) assignments.push("deleted_at = NULL");
    assignments.push("updated_at = now()");

    const result = await client.query(
      `UPDATE categories
       SET ${assignments.join(", ")}
       WHERE id = $1::uuid
       RETURNING ${CATEGORY_COLUMNS}`,
      values
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return responseError(res, 404, "Category not found.");
    }
    await writeAuditLog(client, req, isRestoring ? "category.activated" : "category.updated", "categories", categoryId, existingCategory.rows[0], result.rows[0]);
    await client.query("COMMIT");
    return res.json({ success: true, message: "Category updated successfully.", data: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (isDuplicateSlug(error)) return responseError(res, 409, "Category slug already exists.");
    if (error.code === "23503") return responseError(res, 400, "Parent category does not exist.");
    console.error("Category update failed:", error.message);
    return responseError(res, 500, "Unable to update category.");
  } finally {
    client?.release();
  }
}

async function deactivateCategory(req, res) {
  if (typeof req.params.id !== "string" || !UUID_PATTERN.test(req.params.id)) {
    return responseError(res, 400, "Category ID must be a valid UUID.");
  }

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await client.query(
      "SELECT * FROM categories WHERE id = $1::uuid FOR UPDATE",
      [req.params.id.toLowerCase()]
    );
    if (!before.rows[0]) {
      await client.query("ROLLBACK");
      return responseError(res, 404, "Category not found.");
    }
    const result = await client.query(
      `UPDATE categories
       SET is_active = false, deleted_at = now(), updated_at = now()
       WHERE id = $1::uuid AND deleted_at IS NULL
       RETURNING ${CATEGORY_COLUMNS}`,
      [req.params.id.toLowerCase()]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return responseError(res, 404, "Category not found.");
    }
    await writeAuditLog(client, req, "category.deactivated", "categories", result.rows[0].id, before.rows[0], result.rows[0]);
    await client.query("COMMIT");
    return res.json({ success: true, message: "Category deactivated successfully.", data: result.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Category deactivation failed:", error.message);
    return responseError(res, 500, "Unable to deactivate category.");
  } finally {
    client?.release();
  }
}

module.exports = { listCategories, listAdminCategories, createCategory, updateCategory, deactivateCategory };
