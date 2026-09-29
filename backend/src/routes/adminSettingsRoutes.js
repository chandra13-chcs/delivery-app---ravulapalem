"use strict";

const express = require("express");
const { requireAdmin, requirePermission } = require("../middleware/requireAdmin");
const {
  getAdminDailyOffer,
  updateAdminDailyOffer,
  updateAdminCategoryImage
} = require("../controllers/adminContentController");

const router = express.Router();
router.get("/daily-offer", requireAdmin, requirePermission("offers:manage"), getAdminDailyOffer);
router.put("/daily-offer", requireAdmin, requirePermission("offers:manage"), updateAdminDailyOffer);
router.put("/category-images/:imageKey", requireAdmin, requirePermission("categories:write"), updateAdminCategoryImage);

module.exports = router;