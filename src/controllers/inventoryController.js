const mongoose = require("mongoose");
const Inventory = require("../models/Inventory");
const Product = require("../models/Product");
const { withSellerScope } = require("../utils/tenantScope");

const parsePagination = (query) => {
  const parsedPage = Number.parseInt(String(query.page || "1"), 10);
  const parsedLimit = Number.parseInt(String(query.limit || "20"), 10);

  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 20;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const normalizeStatus = (status) =>
  status ? String(status).toLowerCase() : null;

const listInventory = async (req, res) => {
  try {
    const { status, category, search } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const productQuery = withSellerScope(req.sellerId);
    if (category) {
      productQuery.category = String(category).toLowerCase();
    }

    if (search) {
      productQuery.name = { $regex: String(search), $options: "i" };
    }

    const productIds = (
      await Product.find(productQuery).select("_id")
    ).map((product) => product._id);

    if (productIds.length === 0) {
      return res.status(200).json({
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 1,
        },
      });
    }

    const inventoryQuery = withSellerScope(req.sellerId, {
      productId: { $in: productIds },
    });

    const normalizedStatus = normalizeStatus(status);
    if (normalizedStatus && normalizedStatus !== "all") {
      inventoryQuery.status = normalizedStatus;
    }

    const [rows, total] = await Promise.all([
      Inventory.find(inventoryQuery)
        .populate("productId", "name category unit price status")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      Inventory.countDocuments(inventoryQuery),
    ]);

    return res.status(200).json({
      data: rows.map((row) => ({
        id: row._id,
        sellerId: row.sellerId,
        productId: row.productId?._id || row.productId,
        stock: row.stock,
        status: row.status,
        product: row.productId
          ? {
              id: row.productId._id,
              name: row.productId.name,
              category: row.productId.category,
              unit: row.productId.unit,
              price: row.productId.price,
            }
          : null,
        updatedAt: row.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getInventoryItem = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const row = await Inventory.findOne(
      withSellerScope(req.sellerId, { productId }),
    ).populate("productId", "name category unit price status");

    if (!row) {
      return res.status(404).json({ message: "Inventory item not found" });
    }

    return res.status(200).json({
      item: {
        id: row._id,
        sellerId: row.sellerId,
        productId: row.productId?._id || row.productId,
        stock: row.stock,
        status: row.status,
        product: row.productId
          ? {
              id: row.productId._id,
              name: row.productId.name,
              category: row.productId.category,
              unit: row.productId.unit,
              price: row.productId.price,
            }
          : null,
        updatedAt: row.updatedAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateInventoryItem = async (req, res) => {
  try {
    const { productId } = req.params;
    const { stock, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const product = await Product.findOne(withSellerScope(req.sellerId, { _id: productId }));
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const hasStockUpdate = stock !== undefined;
    const hasStatusUpdate = status !== undefined;

    if (!hasStockUpdate && !hasStatusUpdate) {
      return res.status(400).json({ message: "stock or status is required" });
    }

    const nextStock = hasStockUpdate ? Number(stock) : Number(product.stock || 0);
    if (!Number.isFinite(nextStock) || nextStock < 0) {
      return res.status(400).json({ message: "stock must be a non-negative number" });
    }

    const nextStatus = hasStatusUpdate
      ? String(status).toLowerCase()
      : nextStock <= 0
        ? "inactive"
        : "active";

    if (!["active", "inactive"].includes(nextStatus)) {
      return res.status(400).json({ message: "status must be active or inactive" });
    }

    const inventoryItem = await Inventory.findOneAndUpdate(
      withSellerScope(req.sellerId, { productId }),
      {
        stock: nextStock,
        status: nextStatus,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      },
    );

    product.stock = nextStock;
    product.status = nextStatus;
    await product.save();

    return res.status(200).json({
      message: "Inventory updated successfully",
      item: {
        id: inventoryItem._id,
        sellerId: inventoryItem.sellerId,
        productId: inventoryItem.productId,
        stock: inventoryItem.stock,
        status: inventoryItem.status,
        updatedAt: inventoryItem.updatedAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  listInventory,
  getInventoryItem,
  updateInventoryItem,
};
