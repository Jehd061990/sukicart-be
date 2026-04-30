const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      default: null,
      index: true,
    },
    role: {
      type: String,
      enum: ["ADMIN", "SELLER", "POS", "BUYER", "RIDER"],
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    deviceName: {
      type: String,
      default: "",
      trim: true,
    },
    ipAddress: {
      type: String,
      default: "",
      trim: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    revokedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

sessionSchema.index({
  ownerId: 1,
  role: 1,
  revokedAt: 1,
  lastActiveAt: 1,
});

sessionSchema.index({
  userId: 1,
  revokedAt: 1,
});

module.exports = mongoose.model("Session", sessionSchema);
