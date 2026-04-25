const express = require("express");
const {
  getDashboardStats,
  getRiderAssignments,
  getUsers,
  getSellers,
  getSellerDetails,
  updateSellerStatus,
  getRiders,
  addRider,
  toggleRiderStatus,
  removeRider,
  getBuyers,
  disableBuyer,
  getOrders,
  updateOrderStatus,
} = require("../controllers/adminController");
const { protect, onlyAdmin } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect, onlyAdmin);

router.get("/dashboard-stats", getDashboardStats);
router.get("/rider-assignments", getRiderAssignments);
router.get("/rider-assignments/:orderId", getRiderAssignments);
router.get("/users", getUsers);

router.get("/sellers", getSellers);
router.get("/sellers/:sellerProfileId", getSellerDetails);
router.patch("/sellers/:sellerProfileId/status", updateSellerStatus);

router.get("/riders", getRiders);
router.post("/riders", addRider);
router.patch("/riders/:userId/toggle-active", toggleRiderStatus);
router.delete("/riders/:userId", removeRider);

router.get("/buyers", getBuyers);
router.patch("/buyers/:userId/disable", disableBuyer);

router.get("/orders", getOrders);
router.patch("/orders/:orderId/status", updateOrderStatus);

module.exports = router;
