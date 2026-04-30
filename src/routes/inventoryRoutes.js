const express = require("express");
const {
  listInventory,
  getInventoryItem,
  updateInventoryItem,
} = require("../controllers/inventoryController");
const {
  protect,
  authorizeRoles,
  onlySeller,
} = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", protect, authorizeRoles("SELLER", "POS"), listInventory);
router.get(
  "/:productId",
  protect,
  authorizeRoles("SELLER", "POS"),
  getInventoryItem,
);
router.patch("/:productId", protect, onlySeller, updateInventoryItem);

module.exports = router;
