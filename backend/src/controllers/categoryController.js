const db = require("../config/db");

const CATEGORY_COLUMNS = `id, name, slug, description, parent_id, sort_order,
                         is_active, created_at, updated_at, deleted_at`;
const CATEGORY_FIELDS = new Set(["name", "slug", "description", "parent_id", "sort_order", "is_active"]);
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
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

async function parentExists(parentId) {
  if (parentId === null) return true;
  const result = await db.query(
    "SELECT EXISTS (SELECT 1 FROM categories WHERE id = $1 AND deleted_at IS NULL) AS category_exists",
    [parentId]
  );
  return result.rows[0]?.category_exists === true;
}

async function parentWouldCreateCycle(categoryId, parentId) {
  const result = await db.query(
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

async function listCategories(req, res) {
  try {
    const result = await db.query(
      `SELECT id, name, slug, description, parent_id, sort_order
       FROM categories
       WHERE is_active = true
         AND deleted_at IS NULL
       ORDER BY sort_order ASC, name ASC`
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
  try {
    if (!await parentExists(category.parent_id)) return responseError(res, 400, "Parent category does not exist.");

    const result = await db.query(
      `INSERT INTO categories (name, slug, description, parent_id, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${CATEGORY_COLUMNS}`,
      [category.name, category.slug, category.description, category.parent_id, category.sort_order, category.is_active]
    );
    return res.status(201).json({ success: true, message: "Category created successfully.", data: result.rows[0] });
  } catch (error) {
    if (isDuplicateSlug(error)) return responseError(res, 409, "Category slug already exists.");
    if (error.code === "23503") return responseError(res, 400, "Parent category does not exist.");
    console.error("Category creation failed:", error.message);
    return responseError(res, 500, "Unable to create category.");
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
  try {
    const existingCategory = await db.query(
      "SELECT 1 FROM categories WHERE id = $1::uuid AND deleted_at IS NULL",
      [categoryId]
    );
    if (!existingCategory.rows[0]) return responseError(res, 404, "Category not found.");

    if (Object.prototype.hasOwnProperty.call(category, "parent_id") && !await parentExists(category.parent_id)) {
      return responseError(res, 400, "Parent category does not exist.");
    }
    if (category.parent_id && await parentWouldCreateCycle(categoryId, category.parent_id)) {
      return responseError(res, 400, "A category cannot be its own parent or a descendant of itself.");
    }

    const values = [categoryId];
    const assignments = [];
    for (const field of CATEGORY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(category, field)) {
        values.push(category[field]);
        assignments.push(`${field} = $${values.length}`);
      }
    }
    assignments.push("updated_at = now()");

    const result = await db.query(
      `UPDATE categories
       SET ${assignments.join(", ")}
       WHERE id = $1::uuid AND deleted_at IS NULL
       RETURNING ${CATEGORY_COLUMNS}`,
      values
    );
    if (!result.rows[0]) return responseError(res, 404, "Category not found.");
    return res.json({ success: true, message: "Category updated successfully.", data: result.rows[0] });
  } catch (error) {
    if (isDuplicateSlug(error)) return responseError(res, 409, "Category slug already exists.");
    if (error.code === "23503") return responseError(res, 400, "Parent category does not exist.");
    console.error("Category update failed:", error.message);
    return responseError(res, 500, "Unable to update category.");
  }
}

async function deactivateCategory(req, res) {
  if (typeof req.params.id !== "string" || !UUID_PATTERN.test(req.params.id)) {
    return responseError(res, 400, "Category ID must be a valid UUID.");
  }

  try {
    const result = await db.query(
      `UPDATE categories
       SET is_active = false, deleted_at = now(), updated_at = now()
       WHERE id = $1::uuid AND deleted_at IS NULL
       RETURNING ${CATEGORY_COLUMNS}`,
      [req.params.id.toLowerCase()]
    );
    if (!result.rows[0]) return responseError(res, 404, "Category not found.");
    return res.json({ success: true, message: "Category deactivated successfully.", data: result.rows[0] });
  } catch (error) {
    console.error("Category deactivation failed:", error.message);
    return responseError(res, 500, "Unable to deactivate category.");
  }
}

module.exports = { listCategories, createCategory, updateCategory, deactivateCategory };
