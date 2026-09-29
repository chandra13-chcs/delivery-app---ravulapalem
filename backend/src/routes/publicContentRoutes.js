"use strict";

const express = require("express");
const {
  listPublicBanners,
  getPublicDailyOffer,
  getPublicCategoryImages
} = require("../controllers/adminContentController");

const router = express.Router();
router.get("/banners", listPublicBanners);
router.get("/daily-offer", getPublicDailyOffer);
router.get("/category-images", getPublicCategoryImages);

module.exports = router;