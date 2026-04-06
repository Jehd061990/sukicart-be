const express = require("express");
const { registerBuyer } = require("../controllers/buyerController");

const router = express.Router();

router.post("/register", registerBuyer);

module.exports = router;
