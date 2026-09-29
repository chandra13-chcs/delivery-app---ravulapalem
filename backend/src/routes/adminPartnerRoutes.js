"use strict";

const express = require("express");
const { requireAdmin, requirePermission } = require("../middleware/requireAdmin");
const {
  listAdminPartners,
  getAdminPartner,
  createAdminPartner,
  updateAdminPartner,
  updateAdminPartnerStatus,
  listAdminPartnerMembers,
  addAdminPartnerMember,
  updateAdminPartnerMember,
  createAdminShop,
  updateAdminShop,
  getAdminShopProducts,
  getAdminShopInventory,
  createAdminPartnerProduct,
  listAdminCatalogProducts,
  getAdminCatalogProduct,
  updateAdminCatalogProduct,
  createAdminCatalogVariant,
  updateAdminCatalogVariant,
  updateAdminCatalogInventory
} = require("../controllers/adminPartnerController");

const router = express.Router();
router.use(requireAdmin, requirePermission("partners:manage"));
router.get("/", listAdminPartners);
router.post("/", createAdminPartner);
router.get("/products", listAdminCatalogProducts);
router.get("/products/:productId", getAdminCatalogProduct);
router.patch("/products/:productId", updateAdminCatalogProduct);
router.post("/products/:productId/variants", createAdminCatalogVariant);
router.patch("/variants/:variantId", updateAdminCatalogVariant);
router.patch("/variants/:variantId/inventory", updateAdminCatalogInventory);
router.get("/:partnerId", getAdminPartner);
router.patch("/:partnerId", updateAdminPartner);
router.patch("/:partnerId/status", updateAdminPartnerStatus);
router.get("/:partnerId/members", listAdminPartnerMembers);
router.post("/:partnerId/members", addAdminPartnerMember);
router.patch("/:partnerId/members/:userId", updateAdminPartnerMember);
router.post("/:partnerId/shops", createAdminShop);
router.patch("/:partnerId/shops/:shopId", updateAdminShop);
router.post("/:partnerId/shops/:shopId/products", createAdminPartnerProduct);
router.get("/:partnerId/shops/:shopId/products", getAdminShopProducts);
router.get("/:partnerId/shops/:shopId/inventory", getAdminShopInventory);

module.exports = router;
