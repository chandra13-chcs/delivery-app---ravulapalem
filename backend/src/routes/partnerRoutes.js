const express = require("express");
const {
  getPartnerProfile,
  listPartnerShops,
  listPartnerCategories,
  getPartnerShop,
  getPartnerShopDashboard,
  listPartnerShopProducts,
  listPartnerShopInventory
} = require("../controllers/partnerController");
const {
  updatePartnerShop,
  updatePartnerShopStatus,
  createPartnerProduct,
  updatePartnerProduct,
  deactivatePartnerProduct,
  updatePartnerProductStatus,
  createPartnerVariant,
  updatePartnerVariant,
  updatePartnerInventory
} = require("../controllers/partnerManagementController");
const {
  listPartnerOrders,
  getPartnerOrder,
  updatePartnerOrderStatus
} = require("../controllers/partnerOrderController");
const { issuePickupOtp } = require("../controllers/deliveryController");
const { requirePartner } = require("../middleware/requirePartner");
const {
  listPartnerNotifications,
  markPartnerNotificationRead,
  markAllPartnerNotificationsRead
} = require("../controllers/notificationController");

const router = express.Router();

router.use(requirePartner);
router.get("/me", getPartnerProfile);
router.get("/notifications", listPartnerNotifications);
router.patch("/notifications/read-all", markAllPartnerNotificationsRead);
router.patch("/notifications/:notificationId/read", markPartnerNotificationRead);
router.get("/orders", listPartnerOrders);
router.get("/orders/:orderId", getPartnerOrder);
router.patch("/orders/:orderId/shops/:shopId/status", updatePartnerOrderStatus);
router.post("/orders/:orderId/shops/:shopId/pickup-otp", issuePickupOtp);
router.get("/shops", listPartnerShops);
router.get("/categories", listPartnerCategories);
router.get("/shops/:shopId/dashboard", getPartnerShopDashboard);
router.patch("/shops/:shopId/status", updatePartnerShopStatus);
router.patch("/shops/:shopId", updatePartnerShop);
router.get("/shops/:shopId/products", listPartnerShopProducts);
router.get("/shops/:shopId/inventory", listPartnerShopInventory);
router.post("/shops/:shopId/products", createPartnerProduct);
router.post("/shops/:shopId/products/:productId/variants", createPartnerVariant);
router.patch("/shops/:shopId/products/:productId/variants/:variantId", updatePartnerVariant);
router.patch("/shops/:shopId/products/:productId/status", updatePartnerProductStatus);
router.patch("/shops/:shopId/products/:productId", updatePartnerProduct);
router.delete("/shops/:shopId/products/:productId", deactivatePartnerProduct);
router.get("/shops/:shopId", getPartnerShop);
router.patch("/shops/:shopId/inventory/:variantId", updatePartnerInventory);

module.exports = router;