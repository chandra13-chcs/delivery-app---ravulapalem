const express = require("express");
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

const router = express.Router();

router.use(requireUserAuth);

router.get("/notifications", listRiderNotifications);
router.patch("/notifications/read-all", markAllRiderNotificationsRead);
router.patch("/notifications/:notificationId/read", markRiderNotificationRead);
router.post("/applications", createRiderApplication);
router.get("/me", getRiderProfile);
router.patch("/me", updateRiderProfile);
router.get("/documents", listRiderDocuments);
router.post("/documents", createRiderDocument);
router.get("/availability", getRiderAvailability);
router.put("/availability", setRiderAvailability);
router.get("/dashboard", getRiderDashboard);
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
