const express = require("express");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const {
  listSessions,
  forceLogoutSession,
} = require("../controllers/sessionController");

const router = express.Router();

router.get("/", protect, authorizeRoles("SELLER", "POS"), listSessions);
router.delete("/:id", protect, authorizeRoles("SELLER", "POS"), forceLogoutSession);

module.exports = router;
