"use strict";

const express = require("express");
const { requireAdmin, requirePermission } = require("../middleware/requireAdmin");
const {
  listAdminCategories,
  createCategory,
  updateCategory,
  deactivateCategory
} = require("../controllers/categoryController");

const router = express.Router();
router.use(requireAdmin, requirePermission("categories:write"));
router.get("/", listAdminCategories);
router.post("/", createCategory);
router.patch("/:id", updateCategory);
router.delete("/:id", deactivateCategory);

module.exports = router;
