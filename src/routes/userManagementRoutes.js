const express = require("express");
const { protect, onlyAdmin } = require("../middleware/authMiddleware");

const router = express.Router();

// Only ADMIN can manage users
router.get("/", protect, onlyAdmin, (req, res) => {
  return res
    .status(200)
    .json({ message: "List users (admin)", admin: req.user.id });
});

router.patch("/:id/role", protect, onlyAdmin, (req, res) => {
  return res.status(200).json({
    message: `User ${req.params.id} role updated`,
    admin: req.user.id,
  });
});

router.delete("/:id", protect, onlyAdmin, (req, res) => {
  return res.status(200).json({
    message: `User ${req.params.id} deleted`,
    admin: req.user.id,
  });
});

module.exports = router;
