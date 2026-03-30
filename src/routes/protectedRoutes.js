const express = require("express");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/admin-only", protect, authorizeRoles("ADMIN"), (req, res) => {
  return res.status(200).json({ message: "Welcome admin", user: req.user });
});

module.exports = router;
