"use strict";

const express = require("express");
const { requireUserAuth } = require("../middleware/requireAuth");
const {
  listCustomerAddresses,
  createCustomerAddress,
  updateCustomerAddress,
  setDefaultCustomerAddress,
  deleteCustomerAddress
} = require("../controllers/addressController");

const router = express.Router();

router.use(requireUserAuth);
router.get("/", listCustomerAddresses);
router.post("/", createCustomerAddress);
router.patch("/:id/default", setDefaultCustomerAddress);
router.patch("/:id", updateCustomerAddress);
router.delete("/:id", deleteCustomerAddress);

module.exports = router;