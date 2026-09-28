const express = require("express");
const {
	listCategories,
	createCategory,
	updateCategory,
	deactivateCategory
} = require("../controllers/categoryController");
const { requireAdmin, requirePermission } = require("../middleware/requireAdmin");

const router = express.Router();
const categoryWriteAuthorization = [requireAdmin, requirePermission("categories:write")];

router.get("/", listCategories);
router.post("/", ...categoryWriteAuthorization, createCategory);
router.patch("/:id", ...categoryWriteAuthorization, updateCategory);
router.delete("/:id", ...categoryWriteAuthorization, deactivateCategory);

module.exports = router;
