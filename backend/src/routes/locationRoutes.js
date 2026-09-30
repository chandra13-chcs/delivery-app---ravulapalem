"use strict";

const express = require("express");
const { requireUserAuth } = require("../middleware/requireAuth");
const { checkCustomerServiceability } = require("../controllers/locationController");

const router = express.Router();

router.use(requireUserAuth);
router.post("/serviceability", checkCustomerServiceability);

module.exports = router;
