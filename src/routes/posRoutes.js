const express = require("express");
const { protect, onlySeller } = require("../middleware/authMiddleware");
const { createPOSOrder } = require("../controllers/posController");

const router = express.Router();

// Walk-in customer POS checkout (cash only)
router.post("/orders", protect, onlySeller, createPOSOrder);

module.exports = router;
