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
        "accepted",
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
  },
  {
    timestamps: true,
  },
);

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
