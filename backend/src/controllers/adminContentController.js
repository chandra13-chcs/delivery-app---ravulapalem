"use strict";

const db = require("../config/db");
const { writeAuditLog } = require("../services/auditService");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BANNER_STATUSES = new Set(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "ENDED"]);
const SETTINGS_KEYS = {
  bannerSubtitles: "homepage_banner_subtitles",
  dailyOffer: "daily_offer",
  categoryImages: "category_images"
};
const BANNER_PROJECTION = `SELECT b.id, b.title,
                                  COALESCE(sub.setting_value ->> b.id::text, '') AS subtitle,
                                  b.image_object_key, b.image_url, b.destination_url,
                                  b.placement, b.status, b.starts_at, b.ends_at,
                                  b.sort_order, b.created_at, b.updated_at
                           FROM banners b
                           LEFT JOIN app_settings sub
                             ON sub.setting_key = '${SETTINGS_KEYS.bannerSubtitles}'
                            AND jsonb_typeof(sub.setting_value) = 'object'`;
const OFFER_FIELDS = new Set([
  "is_active", "title", "code", "description", "body", "eyebrow", "image_url", "starts_at", "ends_at"
]);

function respondError(res, status, message) {
  return res.status(status).json({ success: false, message, data: null });
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isValidImageReference(value, optional = false) {
  if (optional && (value == null || value === "")) return true;
  if (typeof value !== "string" || value.length > 80000) return false;
  if (/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateTimestamp(value, field) {
  if (value == null || value === "") return { value: null };
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    return { error: `${field} must be an ISO timestamp with a timezone.` };
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { error: `${field} is invalid.` };
  return { value: date.toISOString() };
}

function validateDestination(value) {
  if (value == null || value === "") return { value: null };
  if (typeof value !== "string" || value.length > 2000) return { error: "destination_url is invalid." };
  if (value.startsWith("/") && !value.startsWith("//")) return { value };
  if (value.startsWith("#")) return { value };
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return { value };
  } catch {}
  return { error: "destination_url must be an http(s), root-relative, or fragment URL." };
}

function validateBanner(body, creating, existing = {}) {
  const allowed = new Set([
    "title", "subtitle", "image_url", "destination_url", "placement", "status", "is_active",
    "sort_order", "starts_at", "ends_at"
  ]);
  if (!isObject(body) || Object.keys(body).some(key => !allowed.has(key))) {
    return { error: "A JSON object with supported banner fields is required." };
  }
  if (creating && (!Object.prototype.hasOwnProperty.call(body, "title")
    || !Object.prototype.hasOwnProperty.call(body, "image_url"))) {
    return { error: "title and image_url are required." };
  }
  if (!creating && !Object.keys(body).length) return { error: "At least one banner field is required." };

  const value = { ...existing };
  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 100) {
      return { error: "title must be between 1 and 100 characters." };
    }
    value.title = body.title.trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "subtitle")) {
    if (typeof body.subtitle !== "string" || body.subtitle.length > 180) return { error: "subtitle must be at most 180 characters." };
    value.subtitle = body.subtitle.trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "image_url")) {
    if (!isValidImageReference(body.image_url)) return { error: "image_url must be an http(s) URL or supported base64 image." };
    value.image_url = body.image_url;
  }
  if (Object.prototype.hasOwnProperty.call(body, "destination_url")) {
    const destination = validateDestination(body.destination_url);
    if (destination.error) return destination;
    value.destination_url = destination.value;
  }
  if (Object.prototype.hasOwnProperty.call(body, "placement")) {
    if (typeof body.placement !== "string" || !/^[A-Z][A-Z0-9_]{0,31}$/.test(body.placement)) {
      return { error: "placement must be an uppercase placement key." };
    }
    value.placement = body.placement;
  }
  if (Object.prototype.hasOwnProperty.call(body, "sort_order")) {
    if (!Number.isInteger(body.sort_order) || body.sort_order < -2147483648 || body.sort_order > 2147483647) {
      return { error: "sort_order must be a valid PostgreSQL integer." };
    }
    value.sort_order = body.sort_order;
  }
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (typeof body.status !== "string" || !BANNER_STATUSES.has(body.status)) return { error: "status is invalid." };
    value.status = body.status;
  } else if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
    if (typeof body.is_active !== "boolean") return { error: "is_active must be a boolean." };
    value.status = body.is_active ? "ACTIVE" : "PAUSED";
  } else if (creating) {
    value.status = "ACTIVE";
  }
  for (const field of ["starts_at", "ends_at"]) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const timestamp = validateTimestamp(body[field], field);
      if (timestamp.error) return timestamp;
      value[field] = timestamp.value;
    }
  }
  value.placement ||= "HOME";
  value.sort_order ??= 0;
  value.starts_at ??= null;
  value.ends_at ??= null;
  if (value.starts_at && value.ends_at && new Date(value.ends_at) <= new Date(value.starts_at)) {
    return { error: "ends_at must be after starts_at." };
  }
  if (value.status === "SCHEDULED" && !value.starts_at) {
    return { error: "Scheduled banners require starts_at." };
  }
  return { value };
}

function validateDailyOffer(body) {
  if (!isObject(body) || Object.keys(body).some(key => !OFFER_FIELDS.has(key))) {
    return { error: "A JSON object with supported offer fields is required." };
  }
  if (typeof body.is_active !== "boolean") return { error: "is_active must be a boolean." };
  for (const [field, max] of [["title", 80], ["description", 180]]) {
    if (typeof body[field] !== "string" || !body[field].trim() || body[field].trim().length > max) {
      return { error: `${field} is required and must be at most ${max} characters.` };
    }
  }
  for (const [field, max] of [["code", 32], ["body", 180], ["eyebrow", 80]]) {
    if (body[field] != null && (typeof body[field] !== "string" || body[field].length > max)) {
      return { error: `${field} must be at most ${max} characters.` };
    }
  }
  const imageUrl = body.image_url == null ? "" : body.image_url;
  if (!isValidImageReference(imageUrl, true)) return { error: "image_url is invalid." };
  const starts = validateTimestamp(body.starts_at, "starts_at");
  const ends = validateTimestamp(body.ends_at, "ends_at");
  if (starts.error) return starts;
  if (ends.error) return ends;
  if (starts.value && ends.value && new Date(ends.value) <= new Date(starts.value)) {
    return { error: "ends_at must be after starts_at." };
  }
  return {
    value: {
      is_active: body.is_active,
      title: body.title.trim(),
      code: (body.code || "").trim(),
      description: body.description.trim(),
      body: (body.body || "").trim(),
      eyebrow: (body.eyebrow || "Today's Mandapeta Offer").trim(),
      image_url: imageUrl,
      starts_at: starts.value,
      ends_at: ends.value
    }
  };
}

function logError(operation, error) {
  console.error(`Admin content ${operation} failed:`, error.message);
}

function queryError(res, error, operation) {
  if (["22P02", "22003", "23514"].includes(error.code)) return respondError(res, 400, "Content values are invalid.");
  logError(operation, error);
  return respondError(res, 500, "Unable to retrieve or save content.");
}

function auditImageReference(value) {
  return value ? "[image set]" : null;
}

function auditBanner(banner) {
  return { ...banner, image_url: auditImageReference(banner.image_url) };
}

function auditOffer(offer) {
  return { ...offer, image_url: auditImageReference(offer.image_url) };
}

async function listAdminBanners(req, res) {
  try {
    const result = await db.query(`${BANNER_PROJECTION} ORDER BY b.sort_order, b.created_at DESC, b.id`);
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return queryError(res, error, "banner listing");
  }
}

async function listPublicBanners(req, res) {
  const placement = req.query.placement == null ? "HOME" : req.query.placement;
  if (typeof placement !== "string" || !/^[A-Z][A-Z0-9_]{0,31}$/.test(placement)) {
    return respondError(res, 400, "placement is invalid.");
  }
  try {
    const [result, configuredResult] = await Promise.all([db.query(
      `${BANNER_PROJECTION}
       WHERE b.placement = $1
         AND b.status IN ('ACTIVE', 'SCHEDULED')
         AND (b.starts_at IS NULL OR b.starts_at <= now())
         AND (b.ends_at IS NULL OR b.ends_at > now())
       ORDER BY b.sort_order, b.created_at DESC, b.id`,
      [placement]
    ), db.query("SELECT EXISTS (SELECT 1 FROM banners WHERE placement = $1) AS configured", [placement])]);
    return res.json({
      success: true,
      configured: configuredResult.rows[0].configured,
      data: result.rows.map(({ id, title, subtitle, image_url, destination_url, placement, status, starts_at, ends_at, sort_order }) => ({
        id, title, subtitle, image_url, destination_url, placement, status, starts_at, ends_at, sort_order
      }))
    });
  } catch (error) {
    return queryError(res, error, "public banner listing");
  }
}

async function saveBannerSubtitle(client, bannerId, subtitle, userId) {
  await client.query(
    `INSERT INTO app_settings (setting_key, setting_value, description, is_public, updated_by_user_id)
     VALUES ($1, jsonb_build_object($2::text, $3::text), 'Subtitle text for PostgreSQL homepage banners.', true, $4)
     ON CONFLICT (setting_key) DO UPDATE
     SET setting_value = (CASE WHEN jsonb_typeof(app_settings.setting_value) = 'object'
                               THEN app_settings.setting_value ELSE '{}'::jsonb END) || EXCLUDED.setting_value,
         is_public = true, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`,
    [SETTINGS_KEYS.bannerSubtitles, bannerId, subtitle, userId]
  );
}

async function createAdminBanner(req, res) {
  const validation = validateBanner(req.body, true);
  if (validation.error) return respondError(res, 400, validation.error);
  const banner = validation.value;
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO banners
         (title, image_object_key, image_url, destination_url, placement, status, starts_at, ends_at, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, image_object_key, image_url, destination_url, placement, status,
                 starts_at, ends_at, sort_order, created_at, updated_at`,
      [banner.title, "admin-managed", banner.image_url, banner.destination_url, banner.placement,
        banner.status, banner.starts_at, banner.ends_at, banner.sort_order]
    );
    await saveBannerSubtitle(client, result.rows[0].id, banner.subtitle || "", req.admin.id);
    const after = { ...result.rows[0], subtitle: banner.subtitle || "" };
    await writeAuditLog(client, req, "banner.created", "banners", result.rows[0].id, null, auditBanner(after));
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: after });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return queryError(res, error, "banner creation");
  } finally {
    client?.release();
  }
}

async function updateAdminBanner(req, res) {
  if (!UUID_PATTERN.test(req.params.id)) return respondError(res, 400, "Banner ID must be a valid UUID.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const beforeResult = await client.query(`${BANNER_PROJECTION} WHERE b.id = $1 FOR UPDATE OF b`, [req.params.id]);
    if (!beforeResult.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Banner not found.");
    }
    const before = beforeResult.rows[0];
    const validation = validateBanner(req.body, false, before);
    if (validation.error) {
      await client.query("ROLLBACK");
      return respondError(res, 400, validation.error);
    }
    const banner = validation.value;
    const updated = await client.query(
      `UPDATE banners
       SET title = $2, image_url = $3, destination_url = $4, placement = $5, status = $6,
           starts_at = $7, ends_at = $8, sort_order = $9, updated_at = now()
       WHERE id = $1
       RETURNING id, title, image_object_key, image_url, destination_url, placement, status,
                 starts_at, ends_at, sort_order, created_at, updated_at`,
      [req.params.id, banner.title, banner.image_url, banner.destination_url, banner.placement,
        banner.status, banner.starts_at, banner.ends_at, banner.sort_order]
    );
    if (Object.prototype.hasOwnProperty.call(req.body, "subtitle")) {
      await saveBannerSubtitle(client, req.params.id, banner.subtitle, req.admin.id);
    }
    const after = { ...updated.rows[0], subtitle: banner.subtitle };
    await writeAuditLog(client, req, "banner.updated", "banners", req.params.id, auditBanner(before), auditBanner(after));
    await client.query("COMMIT");
    return res.json({ success: true, data: after });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return queryError(res, error, "banner update");
  } finally {
    client?.release();
  }
}

async function deactivateAdminBanner(req, res) {
  if (!UUID_PATTERN.test(req.params.id)) return respondError(res, 400, "Banner ID must be a valid UUID.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const beforeResult = await client.query(`${BANNER_PROJECTION} WHERE b.id = $1 FOR UPDATE OF b`, [req.params.id]);
    if (!beforeResult.rows[0]) {
      await client.query("ROLLBACK");
      return respondError(res, 404, "Banner not found.");
    }
    const updated = await client.query(
      "UPDATE banners SET status = 'PAUSED', updated_at = now() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    const after = { ...updated.rows[0], subtitle: beforeResult.rows[0].subtitle };
    await writeAuditLog(client, req, "banner.paused", "banners", req.params.id, auditBanner(beforeResult.rows[0]), auditBanner(after));
    await client.query("COMMIT");
    return res.json({ success: true, data: after });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return queryError(res, error, "banner deactivation");
  } finally {
    client?.release();
  }
}

async function readAppSetting(queryable, key) {
  const result = await queryable.query(
    "SELECT setting_value, is_public, updated_at FROM app_settings WHERE setting_key = $1",
    [key]
  );
  return result.rows[0] || null;
}

function offerIsCurrentlyActive(value) {
  if (!isObject(value) || value.is_active !== true) return false;
  const now = Date.now();
  const starts = value.starts_at == null ? null : new Date(value.starts_at).getTime();
  const ends = value.ends_at == null ? null : new Date(value.ends_at).getTime();
  return (starts == null || (Number.isFinite(starts) && starts <= now))
    && (ends == null || (Number.isFinite(ends) && ends > now));
}

async function getAdminDailyOffer(req, res) {
  try {
    const setting = await readAppSetting(db, SETTINGS_KEYS.dailyOffer);
    return res.json({ success: true, configured: Boolean(setting), data: setting?.setting_value || null, updated_at: setting?.updated_at || null });
  } catch (error) {
    return queryError(res, error, "daily offer retrieval");
  }
}

async function getPublicDailyOffer(req, res) {
  try {
    const setting = await readAppSetting(db, SETTINGS_KEYS.dailyOffer);
    const offer = setting?.is_public ? setting.setting_value : null;
    if (!offerIsCurrentlyActive(offer)) return res.json({ success: true, configured: Boolean(setting), data: null });
    const data = {};
    for (const field of OFFER_FIELDS) data[field] = offer[field] ?? null;
    return res.json({ success: true, configured: true, data });
  } catch (error) {
    return queryError(res, error, "public daily offer retrieval");
  }
}

async function updateAdminDailyOffer(req, res) {
  const validation = validateDailyOffer(req.body);
  if (validation.error) return respondError(res, 400, validation.error);
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await readAppSetting(client, SETTINGS_KEYS.dailyOffer);
    await client.query(
      `INSERT INTO app_settings (setting_key, setting_value, description, is_public, updated_by_user_id)
       VALUES ($1, $2::jsonb, 'Storefront daily offer popup configuration.', true, $3)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value, description = EXCLUDED.description,
           is_public = true, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`,
      [SETTINGS_KEYS.dailyOffer, JSON.stringify(validation.value), req.admin.id]
    );
    await writeAuditLog(client, req, "daily_offer.updated", "app_settings", null,
      before?.setting_value ? auditOffer(before.setting_value) : null, auditOffer(validation.value));
    await client.query("COMMIT");
    return res.json({ success: true, data: validation.value });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return queryError(res, error, "daily offer update");
  } finally {
    client?.release();
  }
}

function sanitizeCategoryImages(value) {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, image]) =>
    /^[A-Za-z0-9_-]{1,128}$/.test(key) && isValidImageReference(image)
  ));
}

async function getPublicCategoryImages(req, res) {
  try {
    const setting = await readAppSetting(db, SETTINGS_KEYS.categoryImages);
    return res.json({
      success: true,
      configured: Boolean(setting?.is_public),
      data: setting?.is_public ? sanitizeCategoryImages(setting.setting_value) : {}
    });
  } catch (error) {
    return queryError(res, error, "category image retrieval");
  }
}

async function updateAdminCategoryImage(req, res) {
  const imageKey = req.params.imageKey;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(imageKey)) return respondError(res, 400, "Category image key is invalid.");
  const imageUrl = req.body?.image_url;
  if (!isValidImageReference(imageUrl, true)) return respondError(res, 400, "image_url must be an http(s) URL or supported base64 image.");
  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const before = await readAppSetting(client, SETTINGS_KEYS.categoryImages);
    await client.query(
      `INSERT INTO app_settings (setting_key, setting_value, description, is_public, updated_by_user_id)
       VALUES ($1, jsonb_build_object($2::text, $3::text), 'Storefront category image references.', true, $4)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = (CASE WHEN jsonb_typeof(app_settings.setting_value) = 'object'
                                 THEN app_settings.setting_value ELSE '{}'::jsonb END) || EXCLUDED.setting_value,
           is_public = true, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`,
      [SETTINGS_KEYS.categoryImages, imageKey, imageUrl, req.admin.id]
    );
    const nextValue = { ...sanitizeCategoryImages(before?.setting_value), [imageKey]: imageUrl };
    await writeAuditLog(client, req, "category_image.updated", "app_settings", UUID_PATTERN.test(imageKey) ? imageKey : null,
      { image_url: auditImageReference(before?.setting_value?.[imageKey]) }, { image_url: auditImageReference(imageUrl) });
    await client.query("COMMIT");
    return res.json({ success: true, data: nextValue });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    return queryError(res, error, "category image update");
  } finally {
    client?.release();
  }
}

module.exports = {
  listAdminBanners,
  listPublicBanners,
  createAdminBanner,
  updateAdminBanner,
  deactivateAdminBanner,
  getAdminDailyOffer,
  getPublicDailyOffer,
  updateAdminDailyOffer,
  getPublicCategoryImages,
  updateAdminCategoryImage
};