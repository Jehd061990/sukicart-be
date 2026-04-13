const mongoose = require("mongoose");
const Product = require("../models/Product");

const ALLOWED_CATEGORIES = ["vegetables", "meat", "fish"];
const ALLOWED_STATUSES = ["active", "inactive"];

const parsePagination = (query) => {
  const parsedPage = Number.parseInt(String(query.page || "1"), 10);
  const parsedLimit = Number.parseInt(String(query.limit || "10"), 10);

  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 50)
      : 10;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const normalizeCategory = (category) =>
  category ? String(category).toLowerCase() : null;

const normalizeStatus = (status) =>
  status ? String(status).toLowerCase() : null;

const applyStockStatusRule = (payload) => {
  const nextPayload = { ...payload };

  if (nextPayload.stock !== undefined && Number(nextPayload.stock) <= 0) {
    nextPayload.status = "inactive";
  }

  return nextPayload;
};

const validateCategory = (category) => {
  if (!category) {
    return null;
  }

  if (!ALLOWED_CATEGORIES.includes(category)) {
    const error = new Error("category must be one of vegetables, meat, fish");
    error.statusCode = 400;
    throw error;
  }

  return category;
};

const validateStatus = (status) => {
  if (!status) {
    return null;
  }

  if (!ALLOWED_STATUSES.includes(status)) {
    const error = new Error("status must be one of active, inactive");
    error.statusCode = 400;
    throw error;
  }

  return status;
};

const buildPaginatedResponse = ({ products, total, page, limit }) => ({
  products,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  },
});

const addProduct = async (req, res) => {
  try {
    const { name, price, stock, unit, category, image, status } = req.body;

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

    const normalizedCategory = validateCategory(normalizeCategory(category));
    const normalizedStatus = validateStatus(normalizeStatus(status));

    const payload = applyStockStatusRule({
      name,
      price,
      stock,
      unit,
      category: normalizedCategory,
      image,
      status: normalizedStatus || "active",
      sellerId: req.user._id,
    });

    const product = await Product.create(payload);

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

    const updates = applyStockStatusRule({ ...req.body });
    delete updates.sellerId;

    if (updates.category !== undefined) {
      updates.category = validateCategory(normalizeCategory(updates.category));
    }

    if (updates.status !== undefined) {
      updates.status = validateStatus(normalizeStatus(updates.status));
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
    const { category, search } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const query = {
      status: "active",
      stock: { $gt: 0 },
    };

    const normalizedCategory = normalizeCategory(category);
    if (normalizedCategory) {
      validateCategory(normalizedCategory);
      query.category = normalizedCategory;
    }

    if (search) {
      query.name = { $regex: String(search), $options: "i" };
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("sellerId", "name email role"),
      Product.countDocuments(query),
    ]);

    return res.status(200).json(
      buildPaginatedResponse({
        products,
        total,
        page,
        limit,
      }),
    );
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

const getSellerProducts = async (req, res) => {
  try {
    const { category, status, search } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const query = {
      sellerId: req.user._id,
    };

    const normalizedCategory = normalizeCategory(category);
    if (normalizedCategory) {
      validateCategory(normalizedCategory);
      query.category = normalizedCategory;
    }

    const normalizedStatus = normalizeStatus(status);
    if (normalizedStatus && normalizedStatus !== "all") {
      validateStatus(normalizedStatus);
      query.status = normalizedStatus;
    }

    if (search) {
      query.name = { $regex: String(search), $options: "i" };
    }

    const [products, total] = await Promise.all([
      Product.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Product.countDocuments(query),
    ]);

    return res.status(200).json(
      buildPaginatedResponse({
        products,
        total,
        page,
        limit,
      }),
    );
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

module.exports = {
  addProduct,
  editProduct,
  deleteProduct,
  getAllProducts,
  getSellerProducts,
};
