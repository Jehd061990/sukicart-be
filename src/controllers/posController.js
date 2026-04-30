const Product = require("../models/Product");
const Order = require("../models/Order");
const Store = require("../models/Store");
const ROLES = require("../constants/roles");
const { getStoreTypeConfig } = require("../config/storeTypeConfig");
const {
  mergeOrderItems,
  safeReduceStock,
  runInTransaction,
} = require("../utils/inventory");

const createPOSOrder = async (req, res) => {
  try {
    const { items, paymentMethod, prescriptionCode, scannedCode } = req.body;

    if (!paymentMethod || String(paymentMethod).toLowerCase() !== "cash") {
      return res.status(400).json({ message: "paymentMethod must be cash" });
    }

    const ownerId = req.user.role === ROLES.POS ? req.user.ownerId : req.user._id;
    const tenantStore = await Store.findOne({ ownerId }).select(
      "storeType configOverrides",
    );

    const resolvedConfig = getStoreTypeConfig(
      tenantStore?.storeType,
      tenantStore?.configOverrides,
    );

    const allowedPaymentMethods =
      resolvedConfig?.businessRules?.paymentMethods || ["cash"];

    if (!allowedPaymentMethods.includes(String(paymentMethod).toLowerCase())) {
      return res.status(400).json({
        message: `paymentMethod must be one of: ${allowedPaymentMethods.join(", ")}`,
      });
    }

    const requiredPosFields = resolvedConfig?.requiredFields?.posOrder || [];
    if (
      requiredPosFields.includes("prescriptionCode") &&
      !String(prescriptionCode || "").trim()
    ) {
      return res.status(400).json({
        message: "prescriptionCode is required for this store type",
      });
    }

    const maxLineItems = Number(resolvedConfig?.businessRules?.maxLineItems || 200);
    if (Array.isArray(items) && items.length > maxLineItems) {
      return res.status(400).json({
        message: `items exceeds maximum allowed line items (${maxLineItems})`,
      });
    }

    const order = await runInTransaction(async (session) => {
      const mergedItems = mergeOrderItems(items);
      const sellerIdForOrder = req.sellerId || req.user._id;
      const productIds = mergedItems.map((item) => item.productId);
      const products = await Product.find({
        _id: { $in: productIds },
        sellerId: sellerIdForOrder,
      }).session(session);

      if (products.length !== productIds.length) {
        const error = new Error("One or more products not found");
        error.statusCode = 404;
        throw error;
      }

      const productById = new Map(products.map((p) => [String(p._id), p]));
      const itemsForOrder = [];
      let total = 0;

      for (const mergedItem of mergedItems) {
        const product = productById.get(String(mergedItem.productId));

        if (String(product.sellerId) !== String(sellerIdForOrder)) {
          const error = new Error(
            `Forbidden: product ${product.name} does not belong to this seller`,
          );
          error.statusCode = 403;
          throw error;
        }

        const lineTotal = Number(
          (product.price * mergedItem.quantity).toFixed(2),
        );
        total += lineTotal;

        itemsForOrder.push({
          productId: product._id,
          sellerId: sellerIdForOrder,
          name: product.name,
          unit: product.unit,
          price: product.price,
          quantity: mergedItem.quantity,
          lineTotal,
        });
      }

      await safeReduceStock(session, itemsForOrder);

      const [createdOrder] = await Order.create(
        [
          {
            items: itemsForOrder,
            total: Number(total.toFixed(2)),
            buyerId: null,
            type: "POS",
            status: "pending",
            sellerId: sellerIdForOrder,
            posMetadata: {
              prescriptionCode: String(prescriptionCode || "").trim(),
              scannedCode: String(scannedCode || "").trim(),
            },
          },
        ],
        { session },
      );

      return createdOrder;
    });

    return res.status(201).json({
      message: "POS order created successfully",
      order,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message });
  }
};

module.exports = {
  createPOSOrder,
};
