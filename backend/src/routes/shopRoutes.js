const express = require("express");
const {
  listShops,
  getShop,
  listShopProducts
} = require("../controllers/shopController");

const router = express.Router();

router.get("/", listShops);
router.get("/:id/products", listShopProducts);
router.get("/:id", getShop);

module.exports = router;