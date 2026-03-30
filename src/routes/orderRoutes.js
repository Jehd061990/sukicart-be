const express = require("express");
const {
  createOrder,
  sellerAcceptOrder,
  updateOrderStatus,
  assignRiderToOrder,
} = require("../controllers/orderController");
const {
  protect,
  onlyBuyer,
  onlySeller,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// Buyer creates ONLINE order
router.post("/", protect, onlyBuyer, createOrder);

// Seller accepts order
router.patch("/:orderId/accept", protect, onlySeller, sellerAcceptOrder);

// Seller or admin assigns rider to order
router.patch(
  "/:orderId/assign-rider",
  protect,
  authorizeRoles("SELLER", "ADMIN"),
  assignRiderToOrder,
);

// Seller updates order status
router.patch("/:orderId/status", protect, onlySeller, updateOrderStatus);

module.exports = router;
