"use strict";

const express = require("express");
const { requireUserAuth } = require("../middleware/requireAuth");
const {
  listUserNotifications,
  markUserNotificationRead,
  markAllUserNotificationsRead
} = require("../controllers/notificationController");

const router = express.Router();

router.use(requireUserAuth);
router.get("/", listUserNotifications);
router.patch("/read-all", markAllUserNotificationsRead);
router.patch("/:notificationId/read", markUserNotificationRead);

module.exports = router;
