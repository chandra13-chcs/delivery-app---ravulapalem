const express = require("express");
const {
  getPartnerProfile,
  listPartnerShops,
  getPartnerShop,
  listPartnerShopProducts,
  listPartnerShopInventory
} = require("../controllers/partnerController");
const {
  updatePartnerShop,
  updatePartnerShopStatus,
  createPartnerProduct,
  updatePartnerProduct,
  deactivatePartnerProduct,
  updatePartnerInventory
} = require("../controllers/partnerManagementController");
const {
  listPartnerOrders,
  getPartnerOrder,
  updatePartnerOrderStatus
} = require("../controllers/partnerOrderController");
const { issuePickupOtp } = require("../controllers/deliveryController");
const { requirePartner } = require("../middleware/requirePartner");

const router = express.Router();

router.use(requirePartner);
router.get("/me", getPartnerProfile);
router.get("/orders", listPartnerOrders);
router.get("/orders/:orderId", getPartnerOrder);
router.patch("/orders/:orderId/shops/:shopId/status", updatePartnerOrderStatus);
router.post("/orders/:orderId/shops/:shopId/pickup-otp", issuePickupOtp);
router.get("/shops", listPartnerShops);
router.patch("/shops/:shopId/status", updatePartnerShopStatus);
router.patch("/shops/:shopId", updatePartnerShop);
router.get("/shops/:shopId/products", listPartnerShopProducts);
router.get("/shops/:shopId/inventory", listPartnerShopInventory);
router.post("/shops/:shopId/products", createPartnerProduct);
router.patch("/shops/:shopId/products/:productId", updatePartnerProduct);
router.delete("/shops/:shopId/products/:productId", deactivatePartnerProduct);
router.get("/shops/:shopId", getPartnerShop);
router.patch("/shops/:shopId/inventory/:variantId", updatePartnerInventory);

module.exports = router;