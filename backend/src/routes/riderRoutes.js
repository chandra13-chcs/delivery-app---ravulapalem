const express = require("express");
const { requireUserAuth } = require("../middleware/requireAuth");
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

const router = express.Router();

router.use(requireUserAuth);

router.post("/applications", createRiderApplication);
router.get("/me", getRiderProfile);
router.patch("/me", updateRiderProfile);
router.get("/documents", listRiderDocuments);
router.post("/documents", createRiderDocument);
router.get("/availability", getRiderAvailability);
router.put("/availability", setRiderAvailability);
router.get("/dashboard", getRiderDashboard);

module.exports = router;
