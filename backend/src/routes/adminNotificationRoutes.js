"use strict";

const express = require("express");
const { requireAdmin } = require("../middleware/requireAdmin");
const {
  listAdminNotifications,
  markAdminNotificationRead
} = require("../controllers/notificationController");

const router = express.Router();

router.use(requireAdmin);
router.get("/", listAdminNotifications);
router.patch("/:notificationId/read", markAdminNotificationRead);

module.exports = router;
