const express = require("express");
const { protect, onlyRider } = require("../middleware/authMiddleware");

const router = express.Router();

// Only RIDER can update delivery status
router.patch("/:deliveryId/status", protect, onlyRider, (req, res) => {
  return res.status(200).json({
    message: `Delivery ${req.params.deliveryId} status updated`,
    rider: req.user.id,
  });
});

module.exports = router;
