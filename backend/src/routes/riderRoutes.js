const express = require("express");
const multer = require("multer");
const { requireUserAuth } = require("../middleware/requireAuth");
const {
  listRiderNotifications,
  markRiderNotificationRead,
  markAllRiderNotificationsRead
} = require("../controllers/notificationController");
const {
  createRiderApplication,
  getRiderProfile,
  updateRiderProfile,
  listRiderDocuments,
  createRiderDocument,
  uploadRiderDocument,
  getRiderAvailability,
  setRiderAvailability,
  getRiderDashboard
} = require("../controllers/riderController");
const {
  listRiderDeliveries,
  acceptDelivery,
  rejectDelivery,
  arriveAtPickup,
  arriveAtParcelPickup,
  confirmPickup,
  startOutForDelivery,
  completeDelivery,
  updateRiderLocation
} = require("../controllers/deliveryController");
const { getRiderEarnings } = require("../controllers/riderEarningsController");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.use(requireUserAuth);

router.get("/notifications", listRiderNotifications);
router.patch("/notifications/read-all", markAllRiderNotificationsRead);
router.patch("/notifications/:notificationId/read", markRiderNotificationRead);
router.post("/applications", createRiderApplication);
router.get("/me", getRiderProfile);
router.patch("/me", updateRiderProfile);
router.get("/documents", listRiderDocuments);
router.post("/documents", createRiderDocument);
router.post("/documents/upload", (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (error) {
      const code = error.code === "LIMIT_FILE_SIZE" ? "UPLOAD_FILE_TOO_LARGE" : "UPLOAD_VALIDATION_ERROR";
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "File must be 10 MB or smaller."
        : "Invalid document upload payload.";
      return res.status(400).json({ success: false, code, message });
    }
    return next();
  });
}, uploadRiderDocument);
router.get("/availability", getRiderAvailability);
router.put("/availability", setRiderAvailability);
router.get("/dashboard", getRiderDashboard);
router.get("/earnings", getRiderEarnings);
router.get("/deliveries", listRiderDeliveries);
router.post("/deliveries/:assignmentId/accept", acceptDelivery);
router.post("/deliveries/:assignmentId/reject", rejectDelivery);
router.post("/deliveries/:assignmentId/pickups/:fulfillmentId/arrive", arriveAtPickup);
router.post("/deliveries/:assignmentId/parcel-pickup/arrive", arriveAtParcelPickup);
router.post("/deliveries/:assignmentId/pickups/:fulfillmentId/confirm", confirmPickup);
router.post("/deliveries/:assignmentId/out-for-delivery", startOutForDelivery);
router.post("/deliveries/:assignmentId/complete", completeDelivery);
router.post("/locations", updateRiderLocation);

module.exports = router;
