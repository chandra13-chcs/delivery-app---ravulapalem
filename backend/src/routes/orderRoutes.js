const express = require("express");
const {
  listCustomerOrders,
  getCustomerOrder,
  createCustomerOrder,
  cancelCustomerOrder
} = require("../controllers/orderController");
const { requireUserAuth } = require("../middleware/requireAuth");
const { getCustomerTracking, issueDeliveryOtp } = require("../controllers/deliveryController");

const router = express.Router();

router.use(requireUserAuth);
router.get("/", listCustomerOrders);
router.post("/", createCustomerOrder);
router.get("/:orderId", getCustomerOrder);
router.post("/:orderId/cancel", cancelCustomerOrder);
router.get("/:orderId/tracking", getCustomerTracking);
router.post("/:orderId/delivery-otp", issueDeliveryOtp);

module.exports = router;
