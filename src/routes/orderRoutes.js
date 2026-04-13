const express = require("express");
const {
  createOrder,
  sellerAcceptOrder,
  updateOrderStatus,
  assignRiderToOrder,
  getOrderTracking,
  updateRiderLocation,
  riderUpdateOrderStatus,
} = require("../controllers/orderController");
const {
  protect,
  onlyBuyer,
  onlySeller,
  onlyRider,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// Buyer creates ONLINE order
router.post("/", protect, onlyBuyer, createOrder);

// Buyer, seller, assigned rider, or admin can read tracking details
router.get(
  "/:orderId/tracking",
  protect,
  authorizeRoles("BUYER", "SELLER", "RIDER", "ADMIN"),
  getOrderTracking,
);

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

// Rider updates delivery status as order progresses in the field
router.patch(
  "/:orderId/rider-status",
  protect,
  onlyRider,
  riderUpdateOrderStatus,
);

// Optional HTTP fallback for location updates (socket remains primary channel)
router.patch(
  "/:orderId/rider-location",
  protect,
  onlyRider,
  updateRiderLocation,
);

module.exports = router;
