const express = require("express");
const {
  loginAdmin,
  refreshAdminSession,
  logoutAdmin,
  getCurrentAdmin
} = require("../controllers/adminAuthController");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();

router.post("/login", loginAdmin);
router.post("/refresh", refreshAdminSession);
router.post("/logout", logoutAdmin);
router.get("/me", requireAdmin, getCurrentAdmin);

module.exports = router;
