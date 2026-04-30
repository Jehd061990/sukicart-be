const express = require("express");
const {
  getMyStoreConfig,
  updateMyStoreConfig,
} = require("../controllers/storeConfigController");
const { protect, authorizeRoles, onlySeller } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/me", protect, authorizeRoles("SELLER", "POS"), getMyStoreConfig);
router.patch("/me", protect, onlySeller, updateMyStoreConfig);

module.exports = router;