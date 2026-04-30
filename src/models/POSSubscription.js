const mongoose = require("mongoose");

const posSubscriptionSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    totalSlots: {
      type: Number,
      default: 1,
      min: 1,
    },
    loginPolicy: {
      type: String,
      enum: ["REJECT", "INVALIDATE_OLDEST"],
      default: process.env.POS_LOGIN_POLICY === "INVALIDATE_OLDEST"
        ? "INVALIDATE_OLDEST"
        : "REJECT",
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("POSSubscription", posSubscriptionSchema);
