const mongoose = require("mongoose");
const Product = require("../models/Product");

const ALLOWED_CATEGORIES = ["vegetables", "meat", "fish"];

const addProduct = async (req, res) => {
  try {
    const { name, price, stock, unit, category, image } = req.body;

    if (
      !name ||
      price === undefined ||
      stock === undefined ||
      !unit ||
      !category
    ) {
      return res.status(400).json({
        message: "name, price, stock, unit, and category are required",
      });
    }

    const normalizedCategory = String(category).toLowerCase();
    if (!ALLOWED_CATEGORIES.includes(normalizedCategory)) {
      return res.status(400).json({
        message: "category must be one of vegetables, meat, fish",
      });
    }

    const product = await Product.create({
      name,
      price,
      stock,
      unit,
      category: normalizedCategory,
      image,
      sellerId: req.user._id,
    });

    return res.status(201).json({
      message: "Product added successfully",
      product,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const editProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (String(product.sellerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden: not your product" });
    }

    const updates = { ...req.body };
    delete updates.sellerId;

    if (updates.category !== undefined) {
      const normalizedCategory = String(updates.category).toLowerCase();
      if (!ALLOWED_CATEGORIES.includes(normalizedCategory)) {
        return res.status(400).json({
          message: "category must be one of vegetables, meat, fish",
        });
      }
      updates.category = normalizedCategory;
    }

    const updatedProduct = await Product.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    return res.status(200).json({
      message: "Product updated successfully",
      product: updatedProduct,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (String(product.sellerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden: not your product" });
    }

    await Product.findByIdAndDelete(id);

    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAllProducts = async (req, res) => {
  try {
    const { category } = req.query;

    const query = {};
    if (category) {
      const normalizedCategory = String(category).toLowerCase();

      if (!ALLOWED_CATEGORIES.includes(normalizedCategory)) {
        return res.status(400).json({
          message: "category filter must be one of vegetables, meat, fish",
        });
      }

      query.category = normalizedCategory;
    }

    const products = await Product.find(query)
      .sort({ createdAt: -1 })
      .populate("sellerId", "name email role");

    return res.status(200).json({
      count: products.length,
      products,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  addProduct,
  editProduct,
  deleteProduct,
  getAllProducts,
};
