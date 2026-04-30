const mongoose = require("mongoose");

const inventorySchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

inventorySchema.index({
  productId: 1,
  sellerId: 1,
}, { unique: true });

inventorySchema.pre("validate", function syncStatusFromStock(next) {
  if (Number(this.stock) <= 0) {
    this.status = "inactive";
  } else if (!this.status) {
    this.status = "active";
  }

  next();
});

module.exports = mongoose.model("Inventory", inventorySchema);
