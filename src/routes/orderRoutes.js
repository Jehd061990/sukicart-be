const express = require("express");
const {
  getMyOrders,
  getMyPendingRiderOffer,
  createOrder,
  sellerAcceptOrder,
  sellerDeclineOrder,
  buyerCancelOrder,
  updateOrderStatus,
  assignRiderToOrder,
  getOrderTracking,
  updateRiderLocation,
  updateSellerLocation,
  riderUpdateOrderStatus,
  sellerGetPickupQr,
  riderConfirmPickupQr,
} = require("../controllers/orderController");
const {
  protect,
  onlyBuyer,
  onlySeller,
  onlyRider,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// Role-aware endpoint for each signed-in user to view their own orders.
router.get(
  "/mine",
  protect,
  authorizeRoles("BUYER", "SELLER", "POS", "RIDER", "ADMIN"),
  getMyOrders,
);

router.get("/rider/pending-offer", protect, onlyRider, getMyPendingRiderOffer);

// Buyer creates ONLINE order
router.post("/", protect, onlyBuyer, createOrder);

// Buyer cancels pending order
router.patch("/:orderId/cancel", protect, onlyBuyer, buyerCancelOrder);

// Buyer, seller, assigned rider, or admin can read tracking details
router.get(
  "/:orderId/tracking",
  protect,
  authorizeRoles("BUYER", "SELLER", "RIDER", "ADMIN"),
  getOrderTracking,
);

// Seller accepts order
router.patch("/:orderId/accept", protect, onlySeller, sellerAcceptOrder);

// Seller declines order
router.patch("/:orderId/decline", protect, onlySeller, sellerDeclineOrder);

// Seller or admin assigns rider to order
router.patch(
  "/:orderId/assign-rider",
  protect,
  authorizeRoles("SELLER", "ADMIN"),
  assignRiderToOrder,
);

// Seller updates order status
router.patch("/:orderId/status", protect, onlySeller, updateOrderStatus);

// Seller gets pickup QR details for rider handoff
router.get("/:orderId/pickup-qr", protect, onlySeller, sellerGetPickupQr);

// Rider updates delivery status as order progresses in the field
router.patch(
  "/:orderId/rider-status",
  protect,
  onlyRider,
  riderUpdateOrderStatus,
);

// Rider confirms pickup by scanning or manually typing seller QR code
router.patch(
  "/:orderId/confirm-pickup",
  protect,
  onlyRider,
  riderConfirmPickupQr,
);

// Optional HTTP fallback for location updates (socket remains primary channel)
router.patch(
  "/:orderId/seller-location",
  protect,
  onlySeller,
  updateSellerLocation,
);

router.patch(
  "/:orderId/rider-location",
  protect,
  onlyRider,
  updateRiderLocation,
);

module.exports = router;
