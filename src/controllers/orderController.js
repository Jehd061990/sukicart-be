const mongoose = require("mongoose");
const Product = require("../models/Product");
const Order = require("../models/Order");
const User = require("../models/User");
const ROLES = require("../constants/roles");
const {
  mergeOrderItems,
  safeReduceStock,
  runInTransaction,
} = require("../utils/inventory");
const { getIo } = require("../socket");
const { buildTrackingPayload } = require("../utils/tracking");

const ORDER_STATUSES = [
  "pending",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "assigned_to_rider",
  "arrived_at_seller",
  "picked_up",
  "out_for_delivery",
  "delivered",
];

const RIDER_UPDATABLE_STATUSES = [
  "arrived_at_seller",
  "picked_up",
  "out_for_delivery",
  "delivered",
];

const isFiniteCoord = (value) => Number.isFinite(Number(value));

const parseGeoLocation = (rawLocation) => {
  if (!rawLocation || typeof rawLocation !== "object") {
    return { lat: null, lng: null, updatedAt: null };
  }

  if (!isFiniteCoord(rawLocation.lat) || !isFiniteCoord(rawLocation.lng)) {
    return { lat: null, lng: null, updatedAt: null };
  }

  return {
    lat: Number(rawLocation.lat),
    lng: Number(rawLocation.lng),
    updatedAt: new Date(),
  };
};

const canTrackOrder = (order, user) => {
  const isAdmin = user.role === ROLES.ADMIN;
  const isBuyer = order.buyerId && String(order.buyerId) === String(user._id);
  const isSeller =
    order.sellerId && String(order.sellerId) === String(user._id);
  const isRider = order.riderId && String(order.riderId) === String(user._id);

  return isAdmin || isBuyer || isSeller || isRider;
};

const emitTrackingUpdate = (order) => {
  try {
    const io = getIo();
    const payload = buildTrackingPayload(order);

    io.to(`order:${order._id}`).emit("order:trackingUpdated", payload);

    if (order.buyerId) {
      io.to(`user:${order.buyerId}`).emit("order:trackingUpdated", payload);
    }

    if (order.sellerId) {
      io.to(`user:${order.sellerId}`).emit("order:trackingUpdated", payload);
    }

    if (order.riderId) {
      io.to(`user:${order.riderId}`).emit("order:trackingUpdated", payload);
    }
  } catch (_socketError) {
    // Ignore socket emission errors so API writes still complete.
  }
};

const createOrder = async (req, res) => {
  try {
    const { items, sellerLocation, buyerLocation } = req.body;

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
      const unifiedSellerId = String(products[0].sellerId);

      for (const p of products) {
        if (String(p.sellerId) !== unifiedSellerId) {
          const error = new Error("All items must belong to one seller");
          error.statusCode = 400;
          throw error;
        }
      }

      const normalizedItems = [];
      let total = 0;

      for (const mergedItem of mergedItems) {
        const product = productById.get(String(mergedItem.productId));
        const lineTotal = Number(
          (product.price * mergedItem.quantity).toFixed(2),
        );
        total += lineTotal;

        normalizedItems.push({
          productId: product._id,
          name: product.name,
          unit: product.unit,
          price: product.price,
          quantity: mergedItem.quantity,
          lineTotal,
        });
      }

      await safeReduceStock(session, normalizedItems);

      const [createdOrder] = await Order.create(
        [
          {
            items: normalizedItems,
            total: Number(total.toFixed(2)),
            buyerId: req.user._id,
            sellerId: products[0].sellerId,
            sellerLocation: parseGeoLocation(sellerLocation),
            buyerLocation: parseGeoLocation(buyerLocation),
            type: "ONLINE",
            status: "pending",
          },
        ],
        { session },
      );

      return createdOrder;
    });

    return res.status(201).json({
      message: "Order created successfully",
      order,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

const sellerAcceptOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (String(order.sellerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden: not your order" });
    }

    if (order.status !== "pending") {
      return res.status(400).json({
        message: "Only pending orders can be accepted",
      });
    }

    order.status = "accepted";
    await order.save();

    return res.status(200).json({
      message: "Order accepted",
      order,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    if (!status || !ORDER_STATUSES.includes(String(status))) {
      return res.status(400).json({
        message:
          "status must be one of pending, accepted, preparing, ready_for_pickup, assigned_to_rider, arrived_at_seller, picked_up, out_for_delivery, delivered",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (String(order.sellerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden: not your order" });
    }

    order.status = String(status);
    await order.save();
    emitTrackingUpdate(order);

    return res.status(200).json({
      message: "Order status updated",
      order,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const assignRiderToOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { riderId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    if (!riderId || !mongoose.Types.ObjectId.isValid(riderId)) {
      return res.status(400).json({ message: "Valid riderId is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const isAdmin = req.user.role === ROLES.ADMIN;
    const isOrderSeller = String(order.sellerId) === String(req.user._id);
    if (!isAdmin && !isOrderSeller) {
      return res
        .status(403)
        .json({ message: "Forbidden: not allowed for this order" });
    }

    const rider = await User.findById(riderId).select("name role");
    if (!rider || rider.role !== ROLES.RIDER) {
      return res
        .status(400)
        .json({ message: "riderId must belong to a RIDER" });
    }

    order.riderId = rider._id;

    if (order.status === "ready_for_pickup" || order.status === "preparing") {
      order.status = "assigned_to_rider";
    }

    await order.save();

    try {
      const io = getIo();
      io.to(`user:${rider._id}`).emit("order:riderAssigned", {
        orderId: String(order._id),
        riderId: String(rider._id),
      });

      if (order.buyerId) {
        io.to(`user:${order.buyerId}`).emit("order:riderAssigned", {
          orderId: String(order._id),
          riderId: String(rider._id),
        });
      }
    } catch (socketError) {
      // Ignore socket emission errors so assignment is still persisted.
    }

    emitTrackingUpdate(order);

    return res.status(200).json({
      message: "Rider assigned successfully",
      order,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getOrderTracking = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const order = await Order.findById(orderId).select(
      "status sellerLocation buyerLocation riderLocation currentLocation buyerId sellerId riderId updatedAt",
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (!canTrackOrder(order, req.user)) {
      return res.status(403).json({ message: "Forbidden: not your order" });
    }

    return res.status(200).json({ order: buildTrackingPayload(order) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateRiderLocation = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { lat, lng } = req.body;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    if (!isFiniteCoord(lat) || !isFiniteCoord(lng)) {
      return res.status(400).json({ message: "lat and lng are required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (!order.riderId || String(order.riderId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden: not your order" });
    }

    const nextLocation = {
      lat: Number(lat),
      lng: Number(lng),
      updatedAt: new Date(),
    };

    order.riderLocation = nextLocation;
    order.currentLocation = nextLocation;
    await order.save();

    emitTrackingUpdate(order);

    return res.status(200).json({
      message: "Rider location updated",
      order: buildTrackingPayload(order),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const riderUpdateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    if (!status || !RIDER_UPDATABLE_STATUSES.includes(String(status))) {
      return res.status(400).json({
        message:
          "status must be one of arrived_at_seller, picked_up, out_for_delivery, delivered",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (!order.riderId || String(order.riderId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden: not your order" });
    }

    order.status = String(status);
    await order.save();

    emitTrackingUpdate(order);

    return res.status(200).json({
      message: "Order status updated",
      order,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createOrder,
  sellerAcceptOrder,
  updateOrderStatus,
  assignRiderToOrder,
  getOrderTracking,
  updateRiderLocation,
  riderUpdateOrderStatus,
  buildTrackingPayload,
  ORDER_STATUSES,
};
