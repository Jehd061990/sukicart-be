const mongoose = require("mongoose");
const User = require("../models/User");
const Order = require("../models/Order");
const SellerProfile = require("../models/SellerProfile");
const BuyerProfile = require("../models/BuyerProfile");
const ROLES = require("../constants/roles");
const { ORDER_STATUSES } = require("./orderController");

const SELLER_STATUSES = ["PENDING", "APPROVED", "REJECTED"];
const SELLER_STATUS_TO_USER_STATUS = {
  PENDING: "pending",
  APPROVED: "active",
  REJECTED: "inactive",
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const getDashboardStats = async (_req, res) => {
  try {
    const [totalUsers, totalSellers, totalOrders, revenueRows] =
      await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: ROLES.SELLER }),
        Order.countDocuments(),
        Order.aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$total" },
            },
          },
        ]),
      ]);

    return res.status(200).json({
      totalUsers,
      totalSellers,
      totalOrders,
      totalRevenue: Number((revenueRows[0]?.totalRevenue || 0).toFixed(2)),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getUsers = async (_req, res) => {
  try {
    const users = await User.find()
      .select("name email role status createdAt")
      .sort({ createdAt: -1 });

    return res.status(200).json({ users });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getSellers = async (_req, res) => {
  try {
    const sellerProfiles = await SellerProfile.find()
      .populate("userId", "name email role isActive")
      .sort({ createdAt: -1 });

    const sellers = sellerProfiles.map((profile) => ({
      id: profile._id,
      userId: profile.userId?._id || null,
      name: profile.userId?.name || profile.fullName,
      email: profile.userId?.email || "",
      storeName: profile.storeName,
      storeType: profile.storeType,
      status: profile.registrationStatus,
      isActive: profile.userId?.isActive ?? true,
      phoneNumber: profile.phoneNumber,
      marketLocation: profile.marketLocation,
      exactAddress: profile.exactAddress,
      createdAt: profile.createdAt,
    }));

    return res.status(200).json({ sellers });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getSellerDetails = async (req, res) => {
  try {
    const { sellerProfileId } = req.params;

    if (!isValidObjectId(sellerProfileId)) {
      return res.status(400).json({ message: "Invalid seller profile id" });
    }

    const sellerProfile = await SellerProfile.findById(
      sellerProfileId,
    ).populate("userId", "name email role isActive createdAt");

    if (!sellerProfile) {
      return res.status(404).json({ message: "Seller not found" });
    }

    return res.status(200).json({ seller: sellerProfile });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateSellerStatus = async (req, res) => {
  try {
    const { sellerProfileId } = req.params;
    const { status } = req.body;

    if (!isValidObjectId(sellerProfileId)) {
      return res.status(400).json({ message: "Invalid seller profile id" });
    }

    const normalizedStatus = String(status || "").toUpperCase();
    if (!SELLER_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        message: "status must be one of PENDING, APPROVED, REJECTED",
      });
    }

    const sellerProfile = await SellerProfile.findById(sellerProfileId);
    if (!sellerProfile) {
      return res.status(404).json({ message: "Seller not found" });
    }

    sellerProfile.registrationStatus = normalizedStatus;

    const linkedUser = await User.findById(sellerProfile.userId);
    if (linkedUser && linkedUser.role === ROLES.SELLER) {
      linkedUser.status = SELLER_STATUS_TO_USER_STATUS[normalizedStatus];
      await linkedUser.save();
    }

    await sellerProfile.save();

    return res.status(200).json({
      message: `Seller status updated to ${normalizedStatus}`,
      seller: sellerProfile,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getRiders = async (_req, res) => {
  try {
    const riders = await User.find({ role: ROLES.RIDER })
      .select("name email phoneNumber role isActive createdAt")
      .sort({ createdAt: -1 });

    return res.status(200).json({ riders });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const addRider = async (req, res) => {
  try {
    const { name, email, password, phoneNumber, isActive } = req.body;

    if (!name || !email || !password || !phoneNumber) {
      return res.status(400).json({
        message: "name, email, password, and phoneNumber are required",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    const rider = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      password,
      phoneNumber: String(phoneNumber).trim(),
      role: ROLES.RIDER,
      status:
        typeof isActive === "boolean" && !isActive ? "inactive" : "active",
    });

    return res.status(201).json({
      message: "Rider created successfully",
      rider: {
        id: rider._id,
        name: rider.name,
        email: rider.email,
        phoneNumber: rider.phoneNumber,
        role: rider.role,
        status: rider.status,
        isActive: rider.status === "active",
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const toggleRiderStatus = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid rider id" });
    }

    const rider = await User.findById(userId);
    if (!rider || rider.role !== ROLES.RIDER) {
      return res.status(404).json({ message: "Rider not found" });
    }

    rider.status = rider.status === "active" ? "inactive" : "active";
    await rider.save();

    return res.status(200).json({
      message: `Rider is now ${rider.status === "active" ? "active" : "inactive"}`,
      rider: {
        id: rider._id,
        status: rider.status,
        isActive: rider.status === "active",
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const removeRider = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid rider id" });
    }

    const rider = await User.findById(userId);
    if (!rider || rider.role !== ROLES.RIDER) {
      return res.status(404).json({ message: "Rider not found" });
    }

    await User.findByIdAndDelete(userId);
    await Order.updateMany({ riderId: userId }, { $set: { riderId: null } });

    return res.status(200).json({ message: "Rider removed successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getBuyers = async (_req, res) => {
  try {
    const buyerProfiles = await BuyerProfile.find()
      .populate("userId", "name email role isActive")
      .sort({ createdAt: -1 });

    const buyers = buyerProfiles.map((profile) => ({
      id: profile._id,
      userId: profile.userId?._id || null,
      name: profile.userId?.name || profile.fullName,
      email: profile.userId?.email || "",
      phoneNumber: profile.phoneNumber,
      city: profile.city,
      barangay: profile.barangay,
      streetAddress: profile.streetAddress,
      isActive: profile.userId?.isActive ?? true,
    }));

    return res.status(200).json({ buyers });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const disableBuyer = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid buyer id" });
    }

    const buyer = await User.findById(userId);
    if (!buyer || buyer.role !== ROLES.BUYER) {
      return res.status(404).json({ message: "Buyer not found" });
    }

    buyer.status = "inactive";
    await buyer.save();

    return res.status(200).json({
      message: "Buyer account disabled",
      buyer: {
        id: buyer._id,
        status: buyer.status,
        isActive: buyer.status === "active",
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};

    if (status && status !== "all") {
      if (!ORDER_STATUSES.includes(String(status))) {
        return res.status(400).json({
          message:
            "status must be one of pending, accepted, preparing, ready_for_pickup, assigned_to_rider, arrived_at_seller, picked_up, out_for_delivery, delivered",
        });
      }

      query.status = String(status);
    }

    const orders = await Order.find(query)
      .populate("buyerId", "name")
      .populate("sellerId", "name")
      .sort({ createdAt: -1 });

    const normalizedOrders = orders.map((order) => ({
      id: order._id,
      buyerName: order.buyerId?.name || "Walk-in Customer",
      sellerName: order.sellerId?.name || "Unknown Seller",
      status: order.status,
      total: order.total,
      createdAt: order.createdAt,
    }));

    return res.status(200).json({ orders: normalizedOrders });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!isValidObjectId(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    if (!status || !ORDER_STATUSES.includes(String(status))) {
      return res.status(400).json({
        message:
          "status must be one of pending, accepted, preparing, ready_for_pickup, assigned_to_rider, arrived_at_seller, picked_up, out_for_delivery, delivered",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    order.status = String(status);
    await order.save();

    return res.status(200).json({
      message: "Order status updated",
      order,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getDashboardStats,
  getUsers,
  getSellers,
  getSellerDetails,
  updateSellerStatus,
  getRiders,
  addRider,
  toggleRiderStatus,
  removeRider,
  getBuyers,
  disableBuyer,
  getOrders,
  updateOrderStatus,
};
