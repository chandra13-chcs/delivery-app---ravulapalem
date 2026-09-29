const express = require("express");
const { getRiderIdentity } = require("../controllers/riderAuthController");
const { requireUserAuth } = require("../middleware/requireAuth");

const router = express.Router();

router.get("/me", requireUserAuth, getRiderIdentity);

module.exports = router;
