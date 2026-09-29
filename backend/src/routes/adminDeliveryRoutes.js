const express = require("express");
const { requireAdmin, requirePermission } = require("../middleware/requireAdmin");
const {
	listAdminDeliveryOrders,
	listEligibleRiders,
	createDeliveryAssignment,
	getAdminAssignmentTracking
} = require("../controllers/deliveryController");

const router = express.Router();
router.use(requireAdmin, requirePermission("deliveries:manage"));
router.get("/orders", listAdminDeliveryOrders);
router.get("/riders", listEligibleRiders);
router.post("/assignments", createDeliveryAssignment);
router.get("/assignments/:assignmentId/tracking", getAdminAssignmentTracking);

module.exports = router;