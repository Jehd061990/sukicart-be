const mongoose = require("mongoose");
const Product = require("../models/Product");

const mergeOrderItems = (rawItems) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    const error = new Error("items is required and must be a non-empty array");
    error.statusCode = 400;
    throw error;
  }

  const mergedItemsMap = new Map();

  for (const item of rawItems) {
    const productId = item?.productId;
    const quantity = Number(item?.quantity);

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      const error = new Error("Each item must have a valid productId");
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      const error = new Error("Each item must have quantity greater than 0");
      error.statusCode = 400;
      throw error;
    }

    const existingQty = mergedItemsMap.get(String(productId)) || 0;
    mergedItemsMap.set(String(productId), existingQty + quantity);
  }

  return [...mergedItemsMap.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
};

const safeReduceStock = async (session, items) => {
  for (const item of items) {
    const updatedProduct = await Product.findOneAndUpdate(
      {
        _id: item.productId,
        stock: { $gte: item.quantity },
      },
      {
        $inc: { stock: -item.quantity },
      },
      {
        new: true,
        session,
      },
    );

    if (!updatedProduct) {
      const error = new Error(
        `Insufficient stock or concurrent update for product ${item.productId}`,
      );
      error.statusCode = 409;
      throw error;
    }
  }
};

const runInTransaction = async (work) => {
  const session = await mongoose.startSession();

  try {
    let result;
    try {
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } catch (error) {
      const message = String(error?.message || "").toLowerCase();
      const unsupportedTransactions =
        message.includes("transaction numbers are only allowed") ||
        message.includes("replica set") ||
        message.includes("does not support transactions");

      if (!unsupportedTransactions) {
        throw error;
      }

      // Fallback for standalone MongoDB deployments where transactions are unavailable.
      return work(undefined);
    }
  } finally {
    await session.endSession();
  }
};

module.exports = {
  mergeOrderItems,
  safeReduceStock,
  runInTransaction,
};
