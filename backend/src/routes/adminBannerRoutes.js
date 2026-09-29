"use strict";

const express = require("express");
const { requireAdmin, requirePermission } = require("../middleware/requireAdmin");
const {
  listAdminBanners,
  createAdminBanner,
  updateAdminBanner,
  deactivateAdminBanner
} = require("../controllers/adminContentController");

const router = express.Router();
const authorize = [requireAdmin, requirePermission("banners:manage")];
router.get("/", ...authorize, listAdminBanners);
router.post("/", ...authorize, createAdminBanner);
router.patch("/:id", ...authorize, updateAdminBanner);
router.delete("/:id", ...authorize, deactivateAdminBanner);

module.exports = router;