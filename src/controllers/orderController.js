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
const {
  assignRider,
  clearAssignmentState,
  updateRiderPresence,
} = require("../services/riderAssignmentService");
const { getIo } = require("../socket");
const {
  buildTrackingPayload,
  isLocationHiddenStatus,
} = require("../utils/tracking");

const ORDER_STATUSES = [
  "pending",
  "cancelled_by_buyer",
  "declined_by_seller",
  "searching_rider",
  "accepted",
  "delivering",
  "completed",
  "preparing",
  "ready_for_pickup",
  "assigned_to_rider",
  "arrived_at_seller",
  "picked_up",
  "out_for_delivery",
  "arrived_at_buyer",
  "delivered",
];

const RIDER_UPDATABLE_STATUSES = [
  "arrived_at_seller",
  "picked_up",
  "delivering",
  "out_for_delivery",
  "arrived_at_buyer",
  "delivered",
  "completed",
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

const generatePickupVerificationCode = () =>
  String(Math.floor(100000 + Math.random() * 900000));

const buildPickupQrValue = (orderId, code) =>
  `SUKICART|${String(orderId)}|${String(code)}`;

const ensurePickupCode = (order, { regenerate = false } = {}) => {
  const needsNewCode =
    regenerate || !order.pickupVerificationCode || !order.pickupQrValue;

  if (!needsNewCode) {
    return;
  }

  const code = generatePickupVerificationCode();
  order.pickupVerificationCode = code;
  order.pickupQrValue = buildPickupQrValue(order._id, code);
  order.pickupCodeIssuedAt = new Date();
  order.pickupCodeVerifiedAt = null;
};

const canUsePickupQrStage = (order) => {
  const status = String(order?.status || "");

  if (
    ["ready_for_pickup", "assigned_to_rider", "arrived_at_seller"].includes(
      status,
    )
  ) {
    return true;
  }

  // Backward compatibility: older flows may still keep rider-assigned pickup orders as "accepted".
  return status === "accepted" && Boolean(order?.riderId);
};

const extractPickupCodeFromQr = (rawValue) => {
  const value = String(rawValue || "").trim();
  if (!value) {
    return "";
  }

  const parts = value.split("|");
  if (parts.length >= 3) {
    return String(parts[2] || "").trim();
  }

  return value;
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
      io.to(`user:${order.buyerId}`).emit(
        "order:trackingUpdated",
        buildTrackingPayload(order, { id: order.buyerId, role: ROLES.BUYER }),
      );
    }

    if (order.sellerId) {
      io.to(`user:${order.sellerId}`).emit(
        "order:trackingUpdated",
        buildTrackingPayload(order, {
          id: order.sellerId,
          role: ROLES.SELLER,
        }),
      );
    }

    if (order.riderId) {
      io.to(`user:${order.riderId}`).emit(
        "order:trackingUpdated",
        buildTrackingPayload(order, { id: order.riderId, role: ROLES.RIDER }),
      );
    }
  } catch (_socketError) {
    // Ignore socket emission errors so API writes still complete.
  }
};

const emitOrderChanged = (order, action = "updated") => {
  try {
    const io = getIo();
    const payload = {
      orderId: String(order._id),
      status: order.status,
      action,
      updatedAt: order.updatedAt,
    };

    if (order.buyerId) {
      io.to(`user:${order.buyerId}`).emit("order:changed", payload);
    }

    if (order.sellerId) {
      io.to(`user:${order.sellerId}`).emit("order:changed", payload);
    }

    if (order.riderId) {
      io.to(`user:${order.riderId}`).emit("order:changed", payload);
    }

    io.to("admins").emit("order:changed", payload);
  } catch (_socketError) {
    // Ignore socket emission errors so API writes still complete.
  }
};

const normalizeOrderForClient = (order) => ({
  id: String(order._id),
  status: order.status,
  type: order.type,
  total: Number(order.total || 0),
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  pickupCodeIssuedAt: order.pickupCodeIssuedAt || null,
  pickupCodeVerifiedAt: order.pickupCodeVerifiedAt || null,
  hasPickupCode: Boolean(order.pickupVerificationCode),
  sellerCancellationReason: order.sellerCancellationReason || "",
  buyer: order.buyerId
    ? {
        id: String(order.buyerId._id || order.buyerId),
        name: order.buyerId.name || "Buyer",
      }
    : null,
  seller: order.sellerId
    ? {
        id: String(order.sellerId._id || order.sellerId),
        name: order.sellerId.name || "Seller",
      }
    : null,
  rider: order.riderId
    ? {
        id: String(order.riderId._id || order.riderId),
        name: order.riderId.name || "Rider",
      }
    : null,
  items: Array.isArray(order.items)
    ? order.items.map((item) => ({
        productId: String(item.productId),
        name: item.name,
        unit: item.unit,
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 0),
        lineTotal: Number(item.lineTotal || 0),
      }))
    : [],
});

const getMyOrders = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const query = {};

    if (req.user.role === ROLES.BUYER) {
      query.buyerId = req.user._id;
    } else if (req.user.role === ROLES.SELLER) {
      query.sellerId = req.user._id;
    } else if (req.user.role === ROLES.RIDER) {
      query.riderId = req.user._id;
    } else if (req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({ message: "Forbidden: unsupported role" });
    }

    const orders = await Order.find(query)
      .populate("buyerId", "name")
      .populate("sellerId", "name")
      .populate("riderId", "name")
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.status(200).json({
      orders: orders.map(normalizeOrderForClient),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const createOrder = async (req, res) => {
  try {
    const { items, sellerLocation, buyerLocation } = req.body;

    const createdOrders = await runInTransaction(async (session) => {
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

      const normalizedItems = [];

      for (const mergedItem of mergedItems) {
        const product = productById.get(String(mergedItem.productId));
        const lineTotal = Number(
          (product.price * mergedItem.quantity).toFixed(2),
        );

        normalizedItems.push({
          productId: product._id,
          sellerId: product.sellerId,
          name: product.name,
          unit: product.unit,
          price: product.price,
          quantity: mergedItem.quantity,
          lineTotal,
        });
      }

      await safeReduceStock(session, normalizedItems);

      const orderRowsBySellerId = new Map();
      for (const item of normalizedItems) {
        const sellerId = String(item.sellerId);
        const prev = orderRowsBySellerId.get(sellerId) || {
          sellerId: item.sellerId,
          items: [],
          total: 0,
        };

        prev.items.push({
          productId: item.productId,
          name: item.name,
          unit: item.unit,
          price: item.price,
          quantity: item.quantity,
          lineTotal: item.lineTotal,
        });
        prev.total += item.lineTotal;
        orderRowsBySellerId.set(sellerId, prev);
      }

      const orderRows = [...orderRowsBySellerId.values()].map((row) => ({
        items: row.items,
        total: Number(row.total.toFixed(2)),
        totalAmount: Number(row.total.toFixed(2)),
        buyerId: req.user._id,
        sellerId: row.sellerId,
        sellerLocation: parseGeoLocation(sellerLocation),
        buyerLocation: parseGeoLocation(buyerLocation),
        deliveryAddress: parseGeoLocation(buyerLocation),
        type: "ONLINE",
        status: "pending",
      }));

      return Order.create(orderRows, { session });
    });

    const primaryOrder = createdOrders[0];

    for (const createdOrder of createdOrders) {
      emitTrackingUpdate(createdOrder);
      emitOrderChanged(createdOrder, "created");
    }

    return res.status(201).json({
      message: "Order created successfully",
      order: primaryOrder,
      orders: createdOrders,
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

    let order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (String(order.sellerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden: not your order" });
    }

    if (!["pending", "searching_rider"].includes(order.status)) {
      return res.status(400).json({
        message: "Only pending or searching_rider orders can be accepted",
      });
    }

    clearAssignmentState(orderId);

    order.status = "accepted";
    await order.save();

    emitTrackingUpdate(order);
    emitOrderChanged(order, "status_changed");

    return res.status(200).json({
      message: "Order accepted",
      order,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const sellerDeclineOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const reason = String(req.body?.reason || "").trim();

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    let order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (String(order.sellerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden: not your order" });
    }

    const terminalStatuses = ["delivered", "completed", "declined_by_seller"];
    if (terminalStatuses.includes(order.status)) {
      return res.status(400).json({
        message: "Order can no longer be declined",
      });
    }

    if (!reason) {
      return res.status(400).json({
        message: "Cancellation reason is required",
      });
    }

    clearAssignmentState(orderId);

    if (order.riderId) {
      await updateRiderPresence(order.riderId, {
        isAvailable: true,
        currentOrderId: null,
      });
      order.riderId = null;
    }

    order.status = "declined_by_seller";
    order.sellerCancellationReason = reason;
    await order.save();

    try {
      const io = getIo();
      const payload = {
        orderId: String(order._id),
        status: order.status,
        message: `Seller canceled order: ${reason}`,
        sellerCancellationReason: reason,
      };

      if (order.buyerId) {
        io.to(`user:${order.buyerId}`).emit("order_status_update", payload);
      }
      if (order.sellerId) {
        io.to(`user:${order.sellerId}`).emit("order_status_update", payload);
      }
    } catch (_socketError) {
      // Ignore socket emission errors for decline workflow.
    }

    emitTrackingUpdate(order);
    emitOrderChanged(order, "status_changed");

    return res.status(200).json({
      message: "Order declined",
      order,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const buyerCancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    let order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (String(order.buyerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden: not your order" });
    }

    if (order.status !== "pending") {
      return res.status(400).json({
        message: "Only pending orders can be canceled",
      });
    }

    clearAssignmentState(orderId);

    if (order.riderId) {
      await updateRiderPresence(order.riderId, {
        isAvailable: true,
        currentOrderId: null,
      });
      order.riderId = null;
    }

    order.status = "cancelled_by_buyer";
    await order.save();

    try {
      const io = getIo();
      const payload = {
        orderId: String(order._id),
        status: order.status,
        message: "Buyer canceled the order",
      };

      if (order.buyerId) {
        io.to(`user:${order.buyerId}`).emit("order_status_update", payload);
      }
      if (order.sellerId) {
        io.to(`user:${order.sellerId}`).emit("order_status_update", payload);
      }
    } catch (_socketError) {
      // Ignore socket emission errors for cancel workflow.
    }

    emitTrackingUpdate(order);
    emitOrderChanged(order, "status_changed");

    return res.status(200).json({
      message: "Order canceled",
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
          "status must be one of pending, cancelled_by_buyer, declined_by_seller, searching_rider, accepted, delivering, completed, preparing, ready_for_pickup, assigned_to_rider, arrived_at_seller, picked_up, out_for_delivery, delivered",
      });
    }

    let order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (String(order.sellerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden: not your order" });
    }

    const nextStatus = String(status);
    if (nextStatus === "ready_for_pickup") {
      ensurePickupCode(order, { regenerate: true });
    }

    order.status = nextStatus;
    await order.save();

    if (nextStatus === "ready_for_pickup" && !order.riderId) {
      await assignRider(order._id, { fallbackStatus: "ready_for_pickup" });
      order = await Order.findById(orderId);
    }

    if (
      order.riderId &&
      (nextStatus === "delivered" || nextStatus === "completed")
    ) {
      await updateRiderPresence(order.riderId, {
        isAvailable: true,
        currentOrderId: null,
      });
    }

    emitTrackingUpdate(order);
    emitOrderChanged(order, "status_changed");

    return res.status(200).json({
      message: "Order status updated",
      order,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const sellerGetPickupQr = async (req, res) => {
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

    if (!canUsePickupQrStage(order)) {
      return res.status(400).json({
        message:
          "Pickup QR is available only for ready_for_pickup, assigned_to_rider, arrived_at_seller, or accepted orders with rider assigned",
      });
    }

    ensurePickupCode(order);
    await order.save();

    return res.status(200).json({
      orderId: String(order._id),
      status: order.status,
      pickupVerificationCode: order.pickupVerificationCode,
      pickupQrValue: order.pickupQrValue,
      issuedAt: order.pickupCodeIssuedAt,
      verifiedAt: order.pickupCodeVerifiedAt,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const riderConfirmPickupQr = async (req, res) => {
  try {
    const { orderId } = req.params;
    const manualCode = String(req.body?.pickupCode || "").trim();
    const qrValue = String(req.body?.qrValue || "").trim();

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    if (!manualCode && !qrValue) {
      return res.status(400).json({
        message: "pickupCode or qrValue is required",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (!order.riderId || String(order.riderId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden: not your order" });
    }

    if (!canUsePickupQrStage(order)) {
      return res.status(400).json({
        message: "Pickup verification is only allowed at seller pickup stage",
      });
    }

    if (!order.pickupVerificationCode || !order.pickupQrValue) {
      return res.status(400).json({
        message: "Pickup QR has not been generated by seller yet",
      });
    }

    const expectedCode = String(order.pickupVerificationCode);
    const expectedQrValue = String(order.pickupQrValue);
    const scannedCode = extractPickupCodeFromQr(qrValue);

    const matchedByManual = Boolean(manualCode) && manualCode === expectedCode;
    const matchedByQrValue = Boolean(qrValue) && qrValue === expectedQrValue;
    const matchedByScannedCode =
      Boolean(scannedCode) && scannedCode === expectedCode;

    if (!matchedByManual && !matchedByQrValue && !matchedByScannedCode) {
      return res.status(400).json({
        message: "Invalid pickup QR code",
      });
    }

    order.status = "out_for_delivery";
    order.pickupCodeVerifiedAt = new Date();
    await order.save();

    emitTrackingUpdate(order);

    return res.status(200).json({
      message: "Pickup verified. Order is now out for delivery",
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
    emitOrderChanged(order, "rider_assigned");

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

    return res
      .status(200)
      .json({ order: buildTrackingPayload(order, req.user) });
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

    if (isLocationHiddenStatus(order.status)) {
      return res.status(400).json({
        message:
          "Location updates are disabled for completed or cancelled orders",
      });
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
      order: buildTrackingPayload(order, req.user),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateSellerLocation = async (req, res) => {
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

    if (String(order.sellerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden: not your order" });
    }

    if (isLocationHiddenStatus(order.status)) {
      return res.status(400).json({
        message:
          "Location updates are disabled for completed or cancelled orders",
      });
    }

    order.sellerLocation = {
      lat: Number(lat),
      lng: Number(lng),
      updatedAt: new Date(),
    };

    await order.save();

    emitTrackingUpdate(order);

    return res.status(200).json({
      message: "Seller location updated",
      order: buildTrackingPayload(order, req.user),
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
          "status must be one of arrived_at_seller, picked_up, delivering, out_for_delivery, arrived_at_buyer, delivered, completed",
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

    if (order.riderId && (status === "delivered" || status === "completed")) {
      await updateRiderPresence(order.riderId, {
        isAvailable: true,
        currentOrderId: null,
      });
    }

    emitTrackingUpdate(order);
    emitOrderChanged(order, "status_changed");

    return res.status(200).json({
      message: "Order status updated",
      order,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getMyOrders,
  createOrder,
  sellerAcceptOrder,
  sellerDeclineOrder,
  buyerCancelOrder,
  updateOrderStatus,
  assignRiderToOrder,
  getOrderTracking,
  updateRiderLocation,
  updateSellerLocation,
  riderUpdateOrderStatus,
  sellerGetPickupQr,
  riderConfirmPickupQr,
  buildTrackingPayload,
  ORDER_STATUSES,
};
