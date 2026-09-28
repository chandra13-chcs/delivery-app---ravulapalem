const express = require("express");
const { listProductsByCategory } = require("../controllers/productController");

const router = express.Router();

router.get("/", listProductsByCategory);

module.exports = router;
