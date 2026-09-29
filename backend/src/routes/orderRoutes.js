const express = require("express");
const {
  listCustomerOrders,
  getCustomerOrder,
  createCustomerOrder,
  cancelCustomerOrder
} = require("../controllers/orderController");
const { requireUserAuth } = require("../middleware/requireAuth");

const router = express.Router();

router.use(requireUserAuth);
router.get("/", listCustomerOrders);
router.post("/", createCustomerOrder);
router.get("/:orderId", getCustomerOrder);
router.post("/:orderId/cancel", cancelCustomerOrder);

module.exports = router;
