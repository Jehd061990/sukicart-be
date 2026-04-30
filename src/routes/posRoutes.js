const express = require("express");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const { createPOSOrder } = require("../controllers/posController");
const {
	createPOS,
	listPOS,
	deactivatePOS,
	updatePOS,
	upgradePOSSlots,
} = require("../controllers/posManagementController");

const router = express.Router();

// Walk-in customer POS checkout (cash only)
router.post("/orders", protect, authorizeRoles("SELLER", "POS"), createPOSOrder);

router.post("/create", protect, authorizeRoles("SELLER"), createPOS);
router.get("/list", protect, authorizeRoles("SELLER"), listPOS);
router.post("/subscription/upgrade", protect, authorizeRoles("SELLER"), upgradePOSSlots);
router.put("/:id", protect, authorizeRoles("SELLER"), updatePOS);
router.delete("/:id", protect, authorizeRoles("SELLER"), deactivatePOS);

module.exports = router;
