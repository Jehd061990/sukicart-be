const Product = require("../models/Product");
const Order = require("../models/Order");
const {
  mergeOrderItems,
  safeReduceStock,
  runInTransaction,
} = require("../utils/inventory");

const createPOSOrder = async (req, res) => {
  try {
    const { items, paymentMethod } = req.body;

    if (!paymentMethod || String(paymentMethod).toLowerCase() !== "cash") {
      return res.status(400).json({ message: "paymentMethod must be cash" });
    }

    const order = await runInTransaction(async (session) => {
      const mergedItems = mergeOrderItems(items);
      const productIds = mergedItems.map((item) => item.productId);
      const products = await Product.find({ _id: { $in: productIds } }).session(
        session,
      );

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

        if (String(product.sellerId) !== String(req.user._id)) {
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
            sellerId: req.user._id,
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
