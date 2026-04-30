const mongoose = require("mongoose");
const Product = require("../models/Product");
const Inventory = require("../models/Inventory");
const Store = require("../models/Store");
const { withSellerScope } = require("../utils/tenantScope");
const { getStoreTypeConfig } = require("../config/storeTypeConfig");

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

const normalizeBarcode = (barcode) => String(barcode || "").trim();

const normalizeExpiryDate = (expiryDate) => {
  if (expiryDate === undefined) {
    return undefined;
  }

  if (!expiryDate) {
    return null;
  }

  const parsed = new Date(expiryDate);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error("expiryDate must be a valid date");
    error.statusCode = 400;
    throw error;
  }

  return parsed;
};

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

const getTenantProductRules = async (sellerId) => {
  const store = await Store.findOne({ ownerId: sellerId }).select(
    "storeType configOverrides",
  );
  const storeConfig = getStoreTypeConfig(store?.storeType, store?.configOverrides);

  return {
    expiryTracking: Boolean(storeConfig.features?.expiryTracking),
  };
};

const assertUniqueBarcodeForSeller = async ({ sellerId, barcode, excludeId }) => {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) {
    return;
  }

  const query = withSellerScope(sellerId, { barcode: normalized });
  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const existing = await Product.findOne(query).select("_id").lean();
  if (existing) {
    const error = new Error("Barcode already exists for this store");
    error.statusCode = 409;
    throw error;
  }
};

const applyConfigDrivenProductRules = ({ payload, rules, isCreate, currentProduct }) => {
  const nextPayload = { ...payload };

  if (nextPayload.barcode !== undefined) {
    nextPayload.barcode = normalizeBarcode(nextPayload.barcode);
  }

  if (nextPayload.expiryDate !== undefined) {
    nextPayload.expiryDate = normalizeExpiryDate(nextPayload.expiryDate);
  }

  if (rules.expiryTracking) {
    const effectiveExpiryDate =
      nextPayload.expiryDate !== undefined
        ? nextPayload.expiryDate
        : currentProduct?.expiryDate || null;

    if (isCreate && !effectiveExpiryDate) {
      const error = new Error("expiryDate is required for this store type");
      error.statusCode = 400;
      throw error;
    }

    if (!isCreate && nextPayload.expiryDate !== undefined && !effectiveExpiryDate) {
      const error = new Error("expiryDate is required for this store type");
      error.statusCode = 400;
      throw error;
    }
  }

  return nextPayload;
};

const ensureInventoryRowsForProducts = async (products) => {
  if (!Array.isArray(products) || products.length === 0) {
    return;
  }

  const upserts = products.map((product) => ({
    updateOne: {
      filter: {
        productId: product._id,
        sellerId: product.sellerId,
      },
      update: {
        $setOnInsert: {
          stock: Number(product.stock || 0),
          status: Number(product.stock || 0) <= 0 ? "inactive" : "active",
        },
      },
      upsert: true,
    },
  }));

  await Inventory.bulkWrite(upserts, { ordered: false });
};

const attachInventoryState = (products, inventoryRows) => {
  const inventoryByProductId = new Map(
    inventoryRows.map((row) => [String(row.productId), row]),
  );

  return products.map((product) => {
    const inventoryRow = inventoryByProductId.get(String(product._id));
    const plain = product.toObject ? product.toObject() : product;

    return {
      ...plain,
      stock:
        inventoryRow && Number.isFinite(Number(inventoryRow.stock))
          ? Number(inventoryRow.stock)
          : Number(plain.stock || 0),
      status: inventoryRow?.status || plain.status,
    };
  });
};

const addProduct = async (req, res) => {
  try {
    const {
      name,
      price,
      stock,
      unit,
      category,
      image,
      status,
      barcode,
      expiryDate,
    } = req.body;

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
    const tenantRules = await getTenantProductRules(req.sellerId);

    const payload = applyConfigDrivenProductRules({
      payload: applyStockStatusRule({
        name,
        price,
        stock,
        unit,
        category: normalizedCategory,
        image,
        barcode,
        expiryDate,
        status: normalizedStatus || "active",
        sellerId: req.sellerId,
      }),
      rules: tenantRules,
      isCreate: true,
    });

    await assertUniqueBarcodeForSeller({
      sellerId: req.sellerId,
      barcode: payload.barcode,
    });

    const product = await Product.create(payload);

    await Inventory.create({
      productId: product._id,
      sellerId: req.sellerId,
      stock: product.stock,
      status: product.status,
    });

    return res.status(201).json({
      message: "Product added successfully",
      product,
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.barcode) {
      return res
        .status(409)
        .json({ message: "Barcode already exists for this store" });
    }

    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

const editProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const product = await Product.findOne(withSellerScope(req.sellerId, { _id: id }));
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const tenantRules = await getTenantProductRules(req.sellerId);
    const updates = applyConfigDrivenProductRules({
      payload: applyStockStatusRule({ ...req.body }),
      rules: tenantRules,
      isCreate: false,
      currentProduct: product,
    });
    delete updates.sellerId;

    if (updates.category !== undefined) {
      updates.category = validateCategory(normalizeCategory(updates.category));
    }

    if (updates.status !== undefined) {
      updates.status = validateStatus(normalizeStatus(updates.status));
    }

    const effectiveBarcode =
      updates.barcode !== undefined ? updates.barcode : product.barcode;
    await assertUniqueBarcodeForSeller({
      sellerId: req.sellerId,
      barcode: effectiveBarcode,
      excludeId: product._id,
    });

    const updatedProduct = await Product.findOneAndUpdate(
      withSellerScope(req.sellerId, { _id: id }),
      updates,
      {
        new: true,
        runValidators: true,
      },
    );

    if (!updatedProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (updates.stock !== undefined || updates.status !== undefined) {
      const inventoryUpdate = {};
      if (updates.stock !== undefined) {
        inventoryUpdate.stock = updates.stock;
        inventoryUpdate.status =
          Number(updates.stock) <= 0 ? "inactive" : "active";
      }
      if (updates.status !== undefined) {
        inventoryUpdate.status = updates.status;
      }

      await Inventory.findOneAndUpdate(
        withSellerScope(req.sellerId, { productId: id }),
        inventoryUpdate,
        {
          new: true,
          upsert: true,
          runValidators: true,
        },
      );
    }

    return res.status(200).json({
      message: "Product updated successfully",
      product: updatedProduct,
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.barcode) {
      return res
        .status(409)
        .json({ message: "Barcode already exists for this store" });
    }

    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const product = await Product.findOne(withSellerScope(req.sellerId, { _id: id }));
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    await Product.findOneAndDelete(withSellerScope(req.sellerId, { _id: id }));
    await Inventory.findOneAndDelete(
      withSellerScope(req.sellerId, { productId: id }),
    );

    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAllProducts = async (req, res) => {
  try {
    const { category, search } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const query = {};

    const normalizedCategory = normalizeCategory(category);
    if (normalizedCategory) {
      validateCategory(normalizedCategory);
      query.category = normalizedCategory;
    }

    if (search) {
      const normalizedSearch = String(search).trim();
      query.$or = [
        { name: { $regex: normalizedSearch, $options: "i" } },
        { barcode: { $regex: normalizedSearch, $options: "i" } },
      ];
    }

    if (["SELLER", "POS"].includes(String(req.user?.role || "")) && req.sellerId) {
      Object.assign(query, withSellerScope(req.sellerId));
    }

    const candidateProducts = await Product.find(query).select("_id sellerId stock");

    if (candidateProducts.length === 0) {
      return res.status(200).json(
        buildPaginatedResponse({
          products: [],
          total: 0,
          page,
          limit,
        }),
      );
    }

    await ensureInventoryRowsForProducts(candidateProducts);

    const inventoryQuery = {
      productId: { $in: candidateProducts.map((p) => p._id) },
      status: "active",
      stock: { $gt: 0 },
    };

    if (query.sellerId) {
      inventoryQuery.sellerId = query.sellerId;
    }

    const allowedInventoryRows = await Inventory.find(inventoryQuery).select(
      "productId stock status",
    );
    const allowedProductIds = allowedInventoryRows.map((row) => row.productId);

    if (allowedProductIds.length === 0) {
      return res.status(200).json(
        buildPaginatedResponse({
          products: [],
          total: 0,
          page,
          limit,
        }),
      );
    }

    const [products, pageInventoryRows] = await Promise.all([
      Product.find({ _id: { $in: allowedProductIds } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("sellerId", "name email role"),
      Inventory.find({ productId: { $in: allowedProductIds } }).select(
        "productId stock status",
      ),
    ]);

    const hydratedProducts = attachInventoryState(products, pageInventoryRows);
    const total = allowedProductIds.length;

    return res.status(200).json(
      buildPaginatedResponse({
        products: hydratedProducts,
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

    const query = withSellerScope(req.sellerId);

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
      const normalizedSearch = String(search).trim();
      query.$or = [
        { name: { $regex: normalizedSearch, $options: "i" } },
        { barcode: { $regex: normalizedSearch, $options: "i" } },
      ];
    }

    const candidateProducts = await Product.find(query).select("_id sellerId stock");

    if (candidateProducts.length === 0) {
      return res.status(200).json(
        buildPaginatedResponse({
          products: [],
          total: 0,
          page,
          limit,
        }),
      );
    }

    await ensureInventoryRowsForProducts(candidateProducts);

    const inventoryQuery = withSellerScope(req.sellerId, {
      productId: { $in: candidateProducts.map((p) => p._id) },
    });

    if (normalizedStatus && normalizedStatus !== "all") {
      inventoryQuery.status = normalizedStatus;
    }

    const allowedInventoryRows = await Inventory.find(inventoryQuery).select(
      "productId stock status",
    );

    const allowedProductIds = allowedInventoryRows.map((row) => row.productId);
    if (allowedProductIds.length === 0) {
      return res.status(200).json(
        buildPaginatedResponse({
          products: [],
          total: 0,
          page,
          limit,
        }),
      );
    }

    const products = await Product.find({ _id: { $in: allowedProductIds } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const hydratedProducts = attachInventoryState(products, allowedInventoryRows);
    const total = allowedProductIds.length;

    return res.status(200).json(
      buildPaginatedResponse({
        products: hydratedProducts,
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
