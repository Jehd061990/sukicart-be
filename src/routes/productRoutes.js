const express = require("express");
const { protect, onlySeller } = require("../middleware/authMiddleware");
const {
  addProduct,
  editProduct,
  deleteProduct,
  getAllProducts,
} = require("../controllers/productController");

const router = express.Router();

router.get("/", getAllProducts);

// Only SELLER can manage products
router.post("/", protect, onlySeller, addProduct);
router.put("/:id", protect, onlySeller, editProduct);
router.delete("/:id", protect, onlySeller, deleteProduct);

// Usage: GET /api/products?category=vegetables|meat|fish

module.exports = router;
