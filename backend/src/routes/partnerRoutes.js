const express = require("express");
const {
  getPartnerProfile,
  listPartnerShops,
  getPartnerShop,
  listPartnerShopProducts,
  listPartnerShopInventory
} = require("../controllers/partnerController");
const { requirePartner } = require("../middleware/requirePartner");

const router = express.Router();

router.use(requirePartner);
router.get("/me", getPartnerProfile);
router.get("/shops", listPartnerShops);
router.get("/shops/:shopId/products", listPartnerShopProducts);
router.get("/shops/:shopId/inventory", listPartnerShopInventory);
router.get("/shops/:shopId", getPartnerShop);

module.exports = router;