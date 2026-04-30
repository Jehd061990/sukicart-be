const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ["ADMIN", "SELLER", "POS", "BUYER", "RIDER"],
      default: "BUYER",
      required: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      default: null,
      index: true,
    },
    posMeta: {
      posName: {
        type: String,
        default: "",
        trim: true,
      },
      isPOSAccount: {
        type: Boolean,
        default: false,
        index: true,
      },
      isDeactivated: {
        type: Boolean,
        default: false,
        index: true,
      },
    },
    status: {
      type: String,
      enum: ["active", "inactive", "pending"],
      default: "active",
      index: true,
    },
    phoneNumber: {
      type: String,
      trim: true,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    riderMeta: {
      isOnline: {
        type: Boolean,
        default: false,
      },
      isAvailable: {
        type: Boolean,
        default: true,
      },
      currentLocation: {
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
      currentOrderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
        default: null,
      },
      rating: {
        type: Number,
        default: 4.5,
        min: 0,
        max: 5,
      },
    },
  },
  {
    timestamps: true,
  },
);

userSchema.index({
  role: 1,
  "riderMeta.isOnline": 1,
  "riderMeta.isAvailable": 1,
});

userSchema.index({
  ownerId: 1,
  role: 1,
  "posMeta.isPOSAccount": 1,
  "posMeta.isDeactivated": 1,
});

userSchema.pre("validate", function syncStatusAndIsActive(next) {
  if (this.isModified("status")) {
    this.isActive = this.status === "active";
  } else if (this.isModified("isActive")) {
    this.status = this.isActive ? "active" : "inactive";
  }

  next();
});

userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function comparePassword(
  candidatePassword,
) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);

module.exports = User;
