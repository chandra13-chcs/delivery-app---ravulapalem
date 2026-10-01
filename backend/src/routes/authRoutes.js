const express = require("express");
const {
  registerCustomer,
  requestLoginOtp,
  loginCustomerWithPassword,
  verifyCustomerOtp,
  getCurrentCustomer,
  logoutCustomer
} = require("../controllers/authController");
const { requireUserAuth } = require("../middleware/requireAuth");

const router = express.Router();

router.post("/register", registerCustomer);
router.post("/otp/request", requestLoginOtp);
router.post("/password/login", loginCustomerWithPassword);
router.post("/otp/verify", verifyCustomerOtp);
router.get("/me", requireUserAuth, getCurrentCustomer);
router.post("/logout", requireUserAuth, logoutCustomer);

module.exports = router;
