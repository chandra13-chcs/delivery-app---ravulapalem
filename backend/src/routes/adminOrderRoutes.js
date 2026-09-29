const express = require("express");
const { listAdminOrders, getAdminOrder } = require("../controllers/adminOrderController");
const { requireAdmin, requirePermission } = require("../middleware/requireAdmin");

const router = express.Router();
const orderReadAuthorization = [requireAdmin, requirePermission("orders:read")];

router.get("/", ...orderReadAuthorization, listAdminOrders);
router.get("/:orderId", ...orderReadAuthorization, getAdminOrder);

module.exports = router;
