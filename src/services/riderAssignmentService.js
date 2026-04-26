const mongoose = require("mongoose");
const Order = require("../models/Order");
const User = require("../models/User");
const ROLES = require("../constants/roles");

const OFFER_TIMEOUT_MS = 60_000;
const MAX_NEAREST_RIDERS = 3;
const isAssignmentDebugEnabled =
  String(process.env.DEBUG_RIDER_ASSIGNMENT || "").toLowerCase() === "true";

const debugAssignment = (...args) => {
  if (!isAssignmentDebugEnabled) {
    return;
  }

  // Keep logs concise and prefixed for easy filtering.
  console.log("[rider-assignment]", ...args);
};

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

const serializeAssignmentState = (state) => {
  if (!state) {
    return null;
  }

  const remainingOfferMs = Number.isFinite(state.offerStartedAt)
    ? Math.max(0, OFFER_TIMEOUT_MS - (Date.now() - state.offerStartedAt))
    : null;

  return {
    orderId: state.orderId,
    fallbackStatus: state.fallbackStatus,
    currentIndex: state.currentIndex,
    currentRiderId: state.candidates[state.currentIndex]
      ? String(state.candidates[state.currentIndex].rider._id)
      : null,
    remainingOfferMs,
    candidateCount: state.candidates.length,
    candidates: state.candidates.map((entry, index) => ({
      index,
      riderId: String(entry.rider._id),
      riderName: entry.rider.name || "",
      distanceKm: Number(Number(entry.distanceKm || 0).toFixed(2)),
    })),
  };
};

const getAssignmentStateSnapshot = (orderId = null) => {
  if (orderId) {
    return serializeAssignmentState(
      assignmentState.get(String(orderId)) || null,
    );
  }

  return Array.from(assignmentState.values()).map(serializeAssignmentState);
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

    const orderChangedPayload = {
      orderId: String(order._id),
      status,
      action: "status_changed",
      updatedAt: order.updatedAt,
    };

    if (order.buyerId) {
      assignmentIo
        .to(`user:${order.buyerId}`)
        .emit("order:changed", orderChangedPayload);
    }

    if (order.sellerId) {
      assignmentIo
        .to(`user:${order.sellerId}`)
        .emit("order:changed", orderChangedPayload);
    }

    if (order.riderId) {
      assignmentIo
        .to(`user:${order.riderId}`)
        .emit("order:changed", orderChangedPayload);
    }

    assignmentIo.to("admins").emit("order_status_update", payload);
    assignmentIo.to("admins").emit("order:changed", orderChangedPayload);
  } catch (_error) {
    // Socket failures must not block persistence flow.
  }
};

const pickNearbyCandidates = async (order, excludedRiderIds) => {
  const pickupPoint = getPickupPoint(order) || getDeliveryPoint(order);
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

  const candidatesWithLocation = riders
    .map((rider) => {
      const riderPoint = toCoord(rider.riderMeta?.currentLocation);
      if (!riderPoint) {
        return null;
      }

      const distanceKm = pickupPoint ? haversineKm(pickupPoint, riderPoint) : 0;
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

  if (candidatesWithLocation.length) {
    debugAssignment("using nearby candidates", {
      orderId: String(order._id),
      count: candidatesWithLocation.length,
      hasPickupPoint: Boolean(pickupPoint),
    });
    return candidatesWithLocation;
  }

  // Fallback: still offer to online available riders even if GPS is missing.
  const fallbackCandidates = riders
    .map((rider) => ({
      rider,
      distanceKm: 0,
      score: -Number(rider.riderMeta?.rating || 0),
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_NEAREST_RIDERS);

  debugAssignment("using fallback candidates", {
    orderId: String(order._id),
    count: fallbackCandidates.length,
    reason: "missing rider coordinates or pickup point",
    hasPickupPoint: Boolean(pickupPoint),
  });

  return fallbackCandidates;
};

const sendOfferToCurrentCandidate = async (orderId) => {
  const state = assignmentState.get(String(orderId));
  if (!state) {
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

  if (!Array.isArray(state.candidates) || state.candidates.length === 0) {
    const refreshedCandidates = await pickNearbyCandidates(order, new Set());

    if (!refreshedCandidates.length) {
      order.status = state.fallbackStatus || "pending";
      await order.save();
      notifyOrderStatus(order, order.status, {
        message: "No nearby riders available",
      });
      clearAssignmentState(orderId);
      return;
    }

    state.candidates = refreshedCandidates;
    state.currentIndex = 0;
  }

  const pickupPoint = getPickupPoint(order) || getDeliveryPoint(order);
  let selectedCandidate = null;
  let selectedIndex = state.currentIndex % state.candidates.length;

  for (let attempts = 0; attempts < state.candidates.length; attempts += 1) {
    const idx = (state.currentIndex + attempts) % state.candidates.length;
    const candidate = state.candidates[idx];

    const rider = await User.findOne({
      _id: candidate.rider._id,
      role: ROLES.RIDER,
      status: "active",
      "riderMeta.isOnline": true,
      "riderMeta.isAvailable": true,
    }).select("name riderMeta");

    const riderPoint = toCoord(rider?.riderMeta?.currentLocation);
    if (!rider) {
      continue;
    }

    selectedIndex = idx;
    selectedCandidate = {
      rider,
      distanceKm:
        pickupPoint && riderPoint
          ? haversineKm(pickupPoint, riderPoint)
          : Number(candidate.distanceKm || 0),
    };
    break;
  }

  if (!selectedCandidate) {
    const refreshedCandidates = await pickNearbyCandidates(order, new Set());
    if (!refreshedCandidates.length) {
      order.status = state.fallbackStatus || "pending";
      await order.save();
      notifyOrderStatus(order, order.status, {
        message: "No nearby riders available",
      });
      clearAssignmentState(orderId);
      return;
    }

    state.candidates = refreshedCandidates;
    state.currentIndex = 0;
    await sendOfferToCurrentCandidate(orderId);
    return;
  }

  state.currentIndex = selectedIndex;

  debugAssignment("sending offer", {
    orderId: String(order._id),
    riderId: String(selectedCandidate.rider._id),
    distanceKm: Number(selectedCandidate.distanceKm || 0),
    candidateIndex: selectedIndex,
    candidatePoolSize: state.candidates.length,
  });

  assignmentIo
    .to(`user:${selectedCandidate.rider._id}`)
    .emit("new_order_request", {
      orderId: String(order._id),
      buyerId: order.buyerId ? String(order.buyerId) : null,
      sellerId: order.sellerId ? String(order.sellerId) : null,
      items: order.items,
      totalAmount: Number(order.totalAmount || order.total || 0),
      pickupLocation: getPickupPoint(order) || getDeliveryPoint(order),
      sellerLocation: getPickupPoint(order) || null,
      deliveryAddress: getDeliveryPoint(order),
      distanceKm: Number(selectedCandidate.distanceKm.toFixed(2)),
      expiresInSec: OFFER_TIMEOUT_MS / 1000,
    });

  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.offerStartedAt = Date.now();

  state.timer = setTimeout(async () => {
    const freshState = assignmentState.get(String(orderId));
    if (!freshState) {
      return;
    }

    if (!freshState.candidates.length) {
      debugAssignment("offer timed out, retrying with refreshed candidates", {
        orderId: String(orderId),
      });
      await sendOfferToCurrentCandidate(orderId);
      return;
    }

    const previousIndex = freshState.currentIndex;
    const nextIndex =
      (freshState.currentIndex + 1) % freshState.candidates.length;

    debugAssignment("offer timed out, rotating rider", {
      orderId: String(orderId),
      fromIndex: previousIndex,
      toIndex: nextIndex,
      candidatePoolSize: freshState.candidates.length,
    });

    freshState.currentIndex = nextIndex;
    await sendOfferToCurrentCandidate(orderId);
  }, OFFER_TIMEOUT_MS);
};

const assignRider = async (orderId, { fallbackStatus = "pending" } = {}) => {
  const order = await Order.findById(orderId);
  if (!order) {
    return { success: false, reason: "ORDER_NOT_FOUND" };
  }

  if (order.riderId) {
    clearAssignmentState(orderId);
    return { success: false, reason: "ALREADY_ASSIGNED" };
  }

  const existingState = assignmentState.get(String(orderId));
  if (existingState) {
    existingState.fallbackStatus = fallbackStatus;
    return {
      success: true,
      offeredToRiderIds: existingState.candidates.map((entry) =>
        String(entry.rider._id),
      ),
    };
  }

  const candidates = await pickNearbyCandidates(order, new Set());
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
    fallbackStatus,
    timer: null,
    offerStartedAt: null,
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

  if (!state.candidates.length) {
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
  }

  state.currentIndex = (state.currentIndex + 1) % state.candidates.length;
  await sendOfferToCurrentCandidate(orderId);
  return { reassigned: true };
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
  getAssignmentStateSnapshot,
};
