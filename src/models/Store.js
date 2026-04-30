const mongoose = require("mongoose");
const {
  STORE_TYPES,
  getSupportedStoreTypes,
} = require("../config/storeTypeConfig");

const storeSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    sellerProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SellerProfile",
      default: null,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    storeType: {
      type: String,
      enum: getSupportedStoreTypes(),
      default: STORE_TYPES.RETAIL,
      index: true,
    },
    configOverrides: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Store", storeSchema);
