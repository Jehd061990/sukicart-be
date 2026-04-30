const mongoose = require("mongoose");
const { getSupportedStoreTypes } = require("../config/storeTypeConfig");

const LEGACY_STORE_TYPES = ["Gulay", "Karne", "Isda", "Mixed"];

const sellerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    storeName: {
      type: String,
      required: true,
      trim: true,
    },
    storeType: {
      type: String,
      enum: [...getSupportedStoreTypes(), ...LEGACY_STORE_TYPES],
      required: true,
    },
    marketLocation: {
      type: String,
      default: "",
      trim: true,
    },
    exactAddress: {
      type: String,
      default: "",
      trim: true,
    },
    dtiPermit: {
      fileName: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      size: { type: Number, default: 0 },
    },
    validId: {
      fileName: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      size: { type: Number, default: 0 },
    },
    handleOwnDelivery: {
      type: Boolean,
      default: false,
    },
    usePlatformRiders: {
      type: Boolean,
      default: true,
    },
    acceptTerms: {
      type: Boolean,
      required: true,
    },
    registrationStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("SellerProfile", sellerProfileSchema);
