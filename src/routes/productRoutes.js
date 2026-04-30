const express = require("express");
const {
  protect,
  requireAuth,
  onlySeller,
  authorizeRoles,
} = require("../middleware/authMiddleware");
const {
  addProduct,
  editProduct,
  deleteProduct,
  getAllProducts,
  getSellerProducts,
} = require("../controllers/productController");

const router = express.Router();

router.get("/", (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return getAllProducts(req, res, next);
  }

  return requireAuth(req, res, () => getAllProducts(req, res, next));
});
router.get("/mine", protect, authorizeRoles("SELLER", "POS"), getSellerProducts);

// Only SELLER can manage products
router.post("/", protect, onlySeller, addProduct);
router.put("/:id", protect, onlySeller, editProduct);
router.delete("/:id", protect, onlySeller, deleteProduct);

// Usage: GET /api/products?category=vegetables|meat|fish

module.exports = router;
