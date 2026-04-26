const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const ROLES = require("../constants/roles");
const {
  buildTrackingPayload,
  isLocationHiddenStatus,
} = require("../utils/tracking");
const {
  acceptOrderOffer,
  declineOrderOffer,
  setRiderAssignmentIo,
  updateRiderPresence,
} = require("../services/riderAssignmentService");

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  setRiderAssignmentIo(io);

  io.use((socket, next) => {
    try {
      const authToken = socket.handshake.auth?.token;
      const headerToken = socket.handshake.headers?.authorization;
      const tokenFromHeader = headerToken?.startsWith("Bearer ")
        ? headerToken.split(" ")[1]
        : null;
      const token = authToken || tokenFromHeader;

      if (!token) {
        return next(new Error("Socket authentication failed: missing token"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = {
        id: decoded.id,
        role: decoded.role,
      };

      return next();
    } catch (error) {
      return next(new Error("Socket authentication failed: invalid token"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.user.id}`);

    if (socket.user.role === ROLES.ADMIN) {
      socket.join("admins");
    }

    if (socket.user.role === ROLES.RIDER) {
      updateRiderPresence(socket.user.id, {
        isOnline: true,
      }).catch(() => null);
    }

    const handleRiderLocationUpdate = async (payload, callback) => {
      try {
        if (socket.user.role !== ROLES.RIDER) {
          const err = new Error("Only riders can update location");
          err.statusCode = 403;
          throw err;
        }

        const orderId = payload?.orderId;
        const lat = Number(payload?.lat);
        const lng = Number(payload?.lng);

        if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
          const err = new Error("Invalid orderId");
          err.statusCode = 400;
          throw err;
        }

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          const err = new Error("lat and lng must be valid numbers");
          err.statusCode = 400;
          throw err;
        }

        const order = await Order.findById(orderId);
        if (!order) {
          const err = new Error("Order not found");
          err.statusCode = 404;
          throw err;
        }

        if (
          !order.riderId ||
          String(order.riderId) !== String(socket.user.id)
        ) {
          const err = new Error("Rider not assigned to this order");
          err.statusCode = 403;
          throw err;
        }

        if (isLocationHiddenStatus(order.status)) {
          const err = new Error(
            "Location updates are disabled for completed or cancelled orders",
          );
          err.statusCode = 400;
          throw err;
        }

        const nextLocation = {
          lat,
          lng,
          updatedAt: new Date(),
        };

        order.riderLocation = nextLocation;
        order.currentLocation = nextLocation;

        await order.save();

        const trackingPayload = buildTrackingPayload(order);

        io.to(`order:${order._id}`).emit(
          "order:trackingUpdated",
          trackingPayload,
        );

        const riderLocationPayload = {
          orderId: String(order._id),
          riderId: String(order.riderId),
          location: order.currentLocation,
        };

        // New requested event contract.
        io.to(`order:${order._id}`).emit(
          "rider-location-update",
          riderLocationPayload,
        );

        if (order.buyerId) {
          io.to(`user:${order.buyerId}`).emit(
            "order:trackingUpdated",
            trackingPayload,
          );
          io.to(`user:${order.buyerId}`).emit(
            "rider-location-update",
            riderLocationPayload,
          );
        }

        if (order.sellerId) {
          io.to(`user:${order.sellerId}`).emit(
            "order:trackingUpdated",
            trackingPayload,
          );
          io.to(`user:${order.sellerId}`).emit(
            "rider-location-update",
            riderLocationPayload,
          );
        }

        io.to(`user:${order.riderId}`).emit(
          "order:trackingUpdated",
          trackingPayload,
        );

        // Backward-compatible event for older tracking page consumers.
        io.to(`order:${order._id}`).emit(
          "order:locationUpdated",
          riderLocationPayload,
        );

        if (typeof callback === "function") {
          callback({ success: true, data: trackingPayload });
        }
      } catch (error) {
        if (typeof callback === "function") {
          callback({
            success: false,
            message: error.message,
            statusCode: error.statusCode || 500,
          });
        }
      }
    };

    socket.on("order:subscribe", async (payload, callback) => {
      try {
        const orderId = payload?.orderId;

        if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
          const err = new Error("Invalid orderId");
          err.statusCode = 400;
          throw err;
        }

        const order = await Order.findById(orderId).select(
          "status sellerLocation buyerLocation riderLocation currentLocation buyerId sellerId riderId",
        );

        if (!order) {
          const err = new Error("Order not found");
          err.statusCode = 404;
          throw err;
        }

        const isAdmin = socket.user.role === ROLES.ADMIN;
        const isBuyer =
          order.buyerId && String(order.buyerId) === String(socket.user.id);
        const isSeller =
          order.sellerId && String(order.sellerId) === String(socket.user.id);
        const isRider =
          order.riderId && String(order.riderId) === String(socket.user.id);

        if (!isAdmin && !isBuyer && !isSeller && !isRider) {
          const err = new Error("Forbidden: not your order");
          err.statusCode = 403;
          throw err;
        }

        socket.join(`order:${orderId}`);

        if (typeof callback === "function") {
          callback({ success: true, data: buildTrackingPayload(order) });
        }
      } catch (error) {
        if (typeof callback === "function") {
          callback({
            success: false,
            message: error.message,
            statusCode: error.statusCode || 500,
          });
        }
      }
    });

    socket.on("rider_location_update", async (payload, callback) => {
      try {
        if (socket.user.role !== ROLES.RIDER) {
          const err = new Error("Only riders can update location");
          err.statusCode = 403;
          throw err;
        }

        const lat = Number(payload?.lat);
        const lng = Number(payload?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          const err = new Error("lat and lng must be valid numbers");
          err.statusCode = 400;
          throw err;
        }

        await updateRiderPresence(socket.user.id, {
          currentLocation: { lat, lng },
        });

        if (typeof callback === "function") {
          callback({ success: true });
        }
      } catch (error) {
        if (typeof callback === "function") {
          callback({
            success: false,
            message: error.message,
            statusCode: error.statusCode || 500,
          });
        }
      }
    });

    socket.on("accept_order", async (payload, callback) => {
      try {
        if (socket.user.role !== ROLES.RIDER) {
          const err = new Error("Only riders can accept order requests");
          err.statusCode = 403;
          throw err;
        }

        const orderId = payload?.orderId;
        if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
          const err = new Error("Invalid orderId");
          err.statusCode = 400;
          throw err;
        }

        const result = await acceptOrderOffer({
          orderId,
          riderId: socket.user.id,
        });

        io.to(`user:${result.order.buyerId}`).emit("order:riderAssigned", {
          orderId: String(result.order._id),
          riderId: String(result.rider._id),
        });

        io.to(`user:${result.order.sellerId}`).emit("order:riderAssigned", {
          orderId: String(result.order._id),
          riderId: String(result.rider._id),
        });

        if (typeof callback === "function") {
          callback({ success: true, orderId: String(result.order._id) });
        }
      } catch (error) {
        if (typeof callback === "function") {
          callback({
            success: false,
            message: error.message,
            statusCode: error.statusCode || 500,
          });
        }
      }
    });

    socket.on("decline_order", async (payload, callback) => {
      try {
        if (socket.user.role !== ROLES.RIDER) {
          const err = new Error("Only riders can decline order requests");
          err.statusCode = 403;
          throw err;
        }

        const orderId = payload?.orderId;
        if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
          const err = new Error("Invalid orderId");
          err.statusCode = 400;
          throw err;
        }

        const result = await declineOrderOffer({
          orderId,
          riderId: socket.user.id,
        });

        if (typeof callback === "function") {
          callback({ success: true, reassigned: result.reassigned });
        }
      } catch (error) {
        if (typeof callback === "function") {
          callback({
            success: false,
            message: error.message,
            statusCode: error.statusCode || 500,
          });
        }
      }
    });

    socket.on("rider:updateLocation", handleRiderLocationUpdate);
    socket.on("update-location", handleRiderLocationUpdate);

    socket.on("disconnect", () => {
      if (socket.user.role === ROLES.RIDER) {
        updateRiderPresence(socket.user.id, {
          isOnline: false,
        }).catch(() => null);
      }
    });
  });

  return io;
};

const getIo = () => {
  if (!io) {
    throw new Error("Socket.io is not initialized");
  }

  return io;
};

module.exports = {
  initSocket,
  getIo,
};
