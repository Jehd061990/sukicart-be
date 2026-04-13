const express = require("express");
const { protect, onlySeller } = require("../middleware/authMiddleware");
const {
  addProduct,
  editProduct,
  deleteProduct,
  getAllProducts,
  getSellerProducts,
} = require("../controllers/productController");

const router = express.Router();

router.get("/", getAllProducts);
router.get("/mine", protect, onlySeller, getSellerProducts);

// Only SELLER can manage products
router.post("/", protect, onlySeller, addProduct);
router.put("/:id", protect, onlySeller, editProduct);
router.delete("/:id", protect, onlySeller, deleteProduct);

// Usage: GET /api/products?category=vegetables|meat|fish

module.exports = router;
