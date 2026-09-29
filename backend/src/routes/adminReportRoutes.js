"use strict";

const express = require("express");
const { requireAdmin, requirePermission } = require("../middleware/requireAdmin");
const {
  getAdminReportSummary,
  listAdminReportShops,
  listAdminReportOrders
} = require("../controllers/adminReportController");

const router = express.Router();
router.use(requireAdmin, requirePermission("orders:read"));
router.get("/summary", getAdminReportSummary);
router.get("/shops", listAdminReportShops);
router.get("/orders", listAdminReportOrders);

module.exports = router;