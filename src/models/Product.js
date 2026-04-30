const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    unit: {
      type: String,
      enum: ["kg", "pcs"],
      required: true,
    },
    category: {
      type: String,
      enum: ["vegetables", "meat", "fish"],
      required: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    image: {
      type: String,
      default: "",
      trim: true,
    },
    barcode: {
      type: String,
      default: "",
      trim: true,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

productSchema.index(
  { sellerId: 1, barcode: 1 },
  {
    unique: true,
    partialFilterExpression: { barcode: { $exists: true, $ne: "" } },
  },
);

productSchema.pre("validate", function syncStatusFromStock(next) {
  if (Number(this.stock) <= 0) {
    this.status = "inactive";
  } else if (!this.status) {
    this.status = "active";
  }

  next();
});

const Product = mongoose.model("Product", productSchema);

module.exports = Product;
