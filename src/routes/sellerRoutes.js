const express = require("express");
const multer = require("multer");
const { registerSeller } = require("../controllers/sellerController");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.post(
  "/register",
  upload.fields([
    { name: "dtiPermit", maxCount: 1 },
    { name: "validId", maxCount: 1 },
  ]),
  registerSeller,
);

module.exports = router;
