const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const ROLES = require("../constants/roles");

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

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

    socket.on("rider:updateLocation", async (payload, callback) => {
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

        order.currentLocation = {
          lat,
          lng,
          updatedAt: new Date(),
        };

        await order.save();

        const trackingPayload = {
          orderId: String(order._id),
          riderId: String(order.riderId),
          location: order.currentLocation,
        };

        if (order.buyerId) {
          io.to(`user:${order.buyerId}`).emit(
            "order:locationUpdated",
            trackingPayload,
          );
        }

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
