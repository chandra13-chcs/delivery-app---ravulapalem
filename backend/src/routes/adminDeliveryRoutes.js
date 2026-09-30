const express = require("express");
const { requireAdmin, requirePermission } = require("../middleware/requireAdmin");
const {
	listAdminDeliveryOrders,
	listEligibleRiders,
	createDeliveryAssignment,
	getAdminAssignmentTracking
} = require("../controllers/deliveryController");
const {
	getAdminRiderEarningConfig,
	updateAdminRiderEarningConfig
} = require("../controllers/riderEarningsController");
const { getAdminEtaConfig, updateAdminEtaConfig } = require("../controllers/etaController");

const router = express.Router();
router.use(requireAdmin, requirePermission("deliveries:manage"));
router.get("/orders", listAdminDeliveryOrders);
router.get("/riders", listEligibleRiders);
router.get("/rider-earnings/config", getAdminRiderEarningConfig);
router.put("/rider-earnings/config", updateAdminRiderEarningConfig);
router.get("/eta-config", getAdminEtaConfig);
router.put("/eta-config", updateAdminEtaConfig);
router.post("/assignments", createDeliveryAssignment);
router.get("/assignments/:assignmentId/tracking", getAdminAssignmentTracking);

module.exports = router;