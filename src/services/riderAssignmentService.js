const mongoose = require("mongoose");
const Order = require("../models/Order");
const User = require("../models/User");
const ROLES = require("../constants/roles");

const OFFER_TIMEOUT_MS = 60_000;
const MAX_NEAREST_RIDERS = 3;
const MAX_RETRY_ROUNDS = 2;

const assignmentState = new Map();
let assignmentIo = null;

const setRiderAssignmentIo = (io) => {
  assignmentIo = io;
};

const hasCoord = (value) => Number.isFinite(Number(value));

const toCoord = (location) => {
  if (!location || typeof location !== "object") {
    return null;
  }

  if (!hasCoord(location.lat) || !hasCoord(location.lng)) {
    return null;
  }

  return {
    lat: Number(location.lat),
    lng: Number(location.lng),
  };
};

const haversineKm = (a, b) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return 6371 * c;
};

const clearAssignmentState = (orderId) => {
  const key = String(orderId);
  const state = assignmentState.get(key);
  if (state?.timer) {
    clearTimeout(state.timer);
  }
  assignmentState.delete(key);
};

const getPickupPoint = (order) => toCoord(order.sellerLocation);

const getDeliveryPoint = (order) =>
  toCoord(order.deliveryAddress) ||
  toCoord(order.buyerLocation) ||
  toCoord(order.sellerLocation);

const notifyOrderStatus = (order, status, extraPayload = {}) => {
  try {
    if (!assignmentIo) {
      return;
    }

    const payload = {
      orderId: String(order._id),
      status,
      riderId: order.riderId ? String(order.riderId) : null,
      ...extraPayload,
    };

    if (order.buyerId) {
      assignmentIo
        .to(`user:${order.buyerId}`)
        .emit("order_status_update", payload);
    }

    if (order.sellerId) {
      assignmentIo
        .to(`user:${order.sellerId}`)
        .emit("order_status_update", payload);
    }

    assignmentIo.to("admins").emit("order_status_update", payload);
  } catch (_error) {
    // Socket failures must not block persistence flow.
  }
};

const pickNearbyCandidates = async (order, excludedRiderIds) => {
  const pickupPoint = getPickupPoint(order) || getDeliveryPoint(order);
  if (!pickupPoint) {
    return [];
  }

  const riders = await User.find({
    role: ROLES.RIDER,
    status: "active",
    "riderMeta.isOnline": true,
    "riderMeta.isAvailable": true,
    _id: {
      $nin: [...excludedRiderIds].map(
        (id) => new mongoose.Types.ObjectId(String(id)),
      ),
    },
  }).select("name riderMeta");

  return riders
    .map((rider) => {
      const riderPoint = toCoord(rider.riderMeta?.currentLocation);
      if (!riderPoint) {
        return null;
      }

      const distanceKm = haversineKm(pickupPoint, riderPoint);
      const rating = Number(rider.riderMeta?.rating || 0);

      // Nearest-first priority with slight bonus for higher rating.
      const score = distanceKm - rating * 0.15;

      return {
        rider,
        distanceKm,
        score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_NEAREST_RIDERS);
};

const sendOfferToCurrentCandidate = async (orderId) => {
  const state = assignmentState.get(String(orderId));
  if (!state) {
    return;
  }

  const candidate = state.candidates[state.currentIndex];
  if (!candidate) {
    return;
  }

  const order = await Order.findById(orderId).select(
    "_id buyerId sellerId items total totalAmount status buyerLocation deliveryAddress",
  );
  if (!order) {
    clearAssignmentState(orderId);
    return;
  }

  if (!assignmentIo) {
    return;
  }

  assignmentIo.to(`user:${candidate.rider._id}`).emit("new_order_request", {
    orderId: String(order._id),
    buyerId: order.buyerId ? String(order.buyerId) : null,
    sellerId: order.sellerId ? String(order.sellerId) : null,
    items: order.items,
    totalAmount: Number(order.totalAmount || order.total || 0),
    pickupLocation: getPickupPoint(order) || getDeliveryPoint(order),
    sellerLocation: getPickupPoint(order) || null,
    deliveryAddress: getDeliveryPoint(order),
    distanceKm: Number(candidate.distanceKm.toFixed(2)),
    expiresInSec: OFFER_TIMEOUT_MS / 1000,
  });

  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = setTimeout(async () => {
    state.responded.add(String(candidate.rider._id));
    state.currentIndex += 1;

    if (state.currentIndex < state.candidates.length) {
      await sendOfferToCurrentCandidate(orderId);
      return;
    }

    if (state.retryRound < MAX_RETRY_ROUNDS) {
      state.retryRound += 1;
      await assignRider(orderId, {
        excludedRiderIds: state.responded,
        retryRound: state.retryRound,
        fallbackStatus: state.fallbackStatus,
      });
      return;
    }

    const freshOrder = await Order.findById(orderId);
    if (freshOrder && !freshOrder.riderId) {
      freshOrder.status = state.fallbackStatus || "pending";
      await freshOrder.save();
      notifyOrderStatus(freshOrder, freshOrder.status, {
        message: "No rider accepted yet. Assignment will be retried manually.",
      });
    }

    clearAssignmentState(orderId);
  }, OFFER_TIMEOUT_MS);
};

const assignRider = async (
  orderId,
  {
    excludedRiderIds = new Set(),
    retryRound = 0,
    fallbackStatus = "pending",
  } = {},
) => {
  const order = await Order.findById(orderId);
  if (!order) {
    return { success: false, reason: "ORDER_NOT_FOUND" };
  }

  if (order.riderId) {
    clearAssignmentState(orderId);
    return { success: false, reason: "ALREADY_ASSIGNED" };
  }

  const existingState = assignmentState.get(String(orderId));
  const mergedExcluded = new Set(excludedRiderIds);
  if (existingState) {
    for (const riderId of existingState.responded) {
      mergedExcluded.add(String(riderId));
    }
  }

  const candidates = await pickNearbyCandidates(order, mergedExcluded);
  if (!candidates.length) {
    order.status = fallbackStatus;
    await order.save();
    notifyOrderStatus(order, order.status, {
      message: "No nearby riders available",
    });
    clearAssignmentState(orderId);
    return { success: false, reason: "NO_CANDIDATES" };
  }

  order.status = "searching_rider";
  await order.save();

  assignmentState.set(String(orderId), {
    orderId: String(orderId),
    candidates,
    currentIndex: 0,
    retryRound,
    fallbackStatus,
    responded: mergedExcluded,
    timer: null,
  });

  await sendOfferToCurrentCandidate(orderId);
  notifyOrderStatus(order, "searching_rider");

  return {
    success: true,
    offeredToRiderIds: candidates.map((entry) => String(entry.rider._id)),
  };
};

const acceptOrderOffer = async ({ orderId, riderId }) => {
  const key = String(orderId);
  const state = assignmentState.get(key);
  if (!state) {
    throw new Error("No active assignment request for this order");
  }

  const currentCandidate = state.candidates[state.currentIndex];
  if (
    !currentCandidate ||
    String(currentCandidate.rider._id) !== String(riderId)
  ) {
    throw new Error("This rider is not the current offer recipient");
  }

  const [order, rider] = await Promise.all([
    Order.findById(orderId),
    User.findById(riderId),
  ]);

  if (!order) {
    clearAssignmentState(orderId);
    throw new Error("Order not found");
  }

  if (!rider || rider.role !== ROLES.RIDER) {
    throw new Error("Rider not found");
  }

  if (order.riderId) {
    clearAssignmentState(orderId);
    throw new Error("Order already assigned");
  }

  if (!rider.riderMeta?.isAvailable) {
    throw new Error("Rider is no longer available");
  }

  order.riderId = rider._id;
  order.status = "accepted";

  if (!rider.riderMeta || typeof rider.riderMeta !== "object") {
    rider.riderMeta = {
      isOnline: false,
      isAvailable: true,
      currentLocation: { lat: null, lng: null, updatedAt: null },
      currentOrderId: null,
      rating: 4.5,
    };
  }

  if (
    !rider.riderMeta.currentLocation ||
    typeof rider.riderMeta.currentLocation !== "object"
  ) {
    rider.riderMeta.currentLocation = {
      lat: null,
      lng: null,
      updatedAt: null,
    };
  }

  rider.riderMeta.isAvailable = false;
  rider.riderMeta.currentOrderId = order._id;

  await Promise.all([order.save(), rider.save()]);

  clearAssignmentState(orderId);

  if (assignmentIo) {
    assignmentIo.to(`user:${rider._id}`).emit("order_offer_result", {
      orderId: String(order._id),
      accepted: true,
    });
  }

  notifyOrderStatus(order, "accepted", {
    riderId: String(rider._id),
    riderName: rider.name,
  });

  return { order, rider };
};

const declineOrderOffer = async ({ orderId, riderId }) => {
  const key = String(orderId);
  const state = assignmentState.get(key);
  if (!state) {
    throw new Error("No active assignment request for this order");
  }

  const currentCandidate = state.candidates[state.currentIndex];
  if (
    !currentCandidate ||
    String(currentCandidate.rider._id) !== String(riderId)
  ) {
    throw new Error("This rider is not the current offer recipient");
  }

  state.responded.add(String(riderId));
  state.currentIndex += 1;

  if (state.currentIndex < state.candidates.length) {
    await sendOfferToCurrentCandidate(orderId);
    return { reassigned: true };
  }

  if (state.retryRound < MAX_RETRY_ROUNDS) {
    const nextRetry = state.retryRound + 1;
    await assignRider(orderId, {
      excludedRiderIds: state.responded,
      retryRound: nextRetry,
      fallbackStatus: state.fallbackStatus,
    });
    return { reassigned: true };
  }

  const order = await Order.findById(orderId);
  if (order && !order.riderId) {
    order.status = state.fallbackStatus || "pending";
    await order.save();
    notifyOrderStatus(order, order.status, {
      message: "No rider accepted the order",
    });
  }

  clearAssignmentState(orderId);
  return { reassigned: false };
};

const updateRiderPresence = async (riderId, updates = {}) => {
  const rider = await User.findOne({ _id: riderId, role: ROLES.RIDER });
  if (!rider) {
    return null;
  }

  const nextMeta = {
    ...(rider.riderMeta?.toObject
      ? rider.riderMeta.toObject()
      : rider.riderMeta || {}),
  };

  if (
    !nextMeta.currentLocation ||
    typeof nextMeta.currentLocation !== "object"
  ) {
    nextMeta.currentLocation = {
      lat: null,
      lng: null,
      updatedAt: null,
    };
  }

  if (typeof updates.isOnline === "boolean") {
    nextMeta.isOnline = updates.isOnline;
  }

  if (typeof updates.isAvailable === "boolean") {
    nextMeta.isAvailable = updates.isAvailable;
  }

  if (updates.currentOrderId !== undefined) {
    nextMeta.currentOrderId = updates.currentOrderId;
  }

  const nextLocation = toCoord(updates.currentLocation);
  if (nextLocation) {
    nextMeta.currentLocation = {
      ...nextLocation,
      updatedAt: new Date(),
    };
  }

  rider.riderMeta = nextMeta;
  await rider.save();

  return rider;
};

module.exports = {
  setRiderAssignmentIo,
  assignRider,
  acceptOrderOffer,
  declineOrderOffer,
  updateRiderPresence,
  clearAssignmentState,
};
