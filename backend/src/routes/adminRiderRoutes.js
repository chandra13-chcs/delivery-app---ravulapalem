const express = require("express");
const { requireAdmin } = require("../middleware/requireAdmin");
const { listAdminRiders, verifyRider } = require("../controllers/adminRiderController");

const router = express.Router();

router.get("/", requireAdmin, listAdminRiders);
router.patch("/:riderId/verification", requireAdmin, verifyRider);

module.exports = router;
