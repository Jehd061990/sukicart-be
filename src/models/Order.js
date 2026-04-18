const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    unit: {
      type: String,
      enum: ["kg", "pcs"],
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0.01,
    },
    lineTotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
);

const geoLocationSchema = new mongoose.Schema(
  {
    lat: {
      type: Number,
      default: null,
    },
    lng: {
      type: Number,
      default: null,
    },
    updatedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    items: {
      type: [itemSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "items must contain at least one item",
      },
      required: true,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmount: {
      type: Number,
      min: 0,
      default: null,
    },
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    sellerLocation: {
      type: geoLocationSchema,
      default: () => ({ lat: null, lng: null, updatedAt: null }),
    },
    buyerLocation: {
      type: geoLocationSchema,
      default: () => ({ lat: null, lng: null, updatedAt: null }),
    },
    deliveryAddress: {
      type: geoLocationSchema,
      default: () => ({ lat: null, lng: null, updatedAt: null }),
    },
    riderLocation: {
      type: geoLocationSchema,
      default: () => ({ lat: null, lng: null, updatedAt: null }),
    },
    // Backward-compatible alias consumed by older client screens.
    currentLocation: {
      type: geoLocationSchema,
      default: () => ({ lat: null, lng: null, updatedAt: null }),
    },
    type: {
      type: String,
      enum: ["ONLINE", "POS"],
      required: true,
      default: "ONLINE",
    },
    status: {
      type: String,
      enum: [
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
        "delivered",
      ],
      required: true,
      default: "pending",
    },
    sellerCancellationReason: {
      type: String,
      trim: true,
      default: "",
    },
    pickupVerificationCode: {
      type: String,
      trim: true,
      default: "",
    },
    pickupQrValue: {
      type: String,
      trim: true,
      default: "",
    },
    pickupCodeIssuedAt: {
      type: Date,
      default: null,
    },
    pickupCodeVerifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
