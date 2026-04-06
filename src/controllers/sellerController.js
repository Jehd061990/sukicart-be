const User = require("../models/User");
const SellerProfile = require("../models/SellerProfile");

const ALLOWED_STORE_TYPES = ["Gulay", "Karne", "Isda", "Mixed"];

const toBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return fallback;
};

const getUploadMeta = (file) => {
  if (!file) {
    return {
      fileName: "",
      mimeType: "",
      size: 0,
    };
  }

  return {
    fileName: file.originalname || "",
    mimeType: file.mimetype || "",
    size: file.size || 0,
  };
};

const registerSeller = async (req, res) => {
  let createdUser = null;

  try {
    const {
      fullName,
      phoneNumber,
      email,
      password,
      storeName,
      storeType,
      marketLocation,
      exactAddress,
      handleOwnDelivery,
      usePlatformRiders,
      acceptTerms,
    } = req.body;

    if (
      !fullName ||
      !phoneNumber ||
      !email ||
      !password ||
      !storeName ||
      !storeType
    ) {
      return res.status(400).json({
        message:
          "fullName, phoneNumber, email, password, storeName, and storeType are required",
      });
    }

    if (!ALLOWED_STORE_TYPES.includes(String(storeType))) {
      return res.status(400).json({
        message: "storeType must be one of Gulay, Karne, Isda, Mixed",
      });
    }

    const parsedHandleOwnDelivery = toBoolean(handleOwnDelivery, false);
    const parsedUsePlatformRiders = toBoolean(usePlatformRiders, true);
    const parsedAcceptTerms = toBoolean(acceptTerms, false);

    if (!parsedHandleOwnDelivery && !parsedUsePlatformRiders) {
      return res.status(400).json({
        message: "Select at least one delivery option",
      });
    }

    if (!parsedAcceptTerms) {
      return res.status(400).json({
        message: "You must accept Terms & Conditions",
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({
        message: "Email is already registered",
      });
    }

    createdUser = await User.create({
      name: String(fullName).trim(),
      email: normalizedEmail,
      password,
      role: "SELLER",
    });

    const dtiPermitFile = req.files?.dtiPermit?.[0];
    const validIdFile = req.files?.validId?.[0];

    const sellerProfile = await SellerProfile.create({
      userId: createdUser._id,
      fullName: String(fullName).trim(),
      phoneNumber: String(phoneNumber).trim(),
      storeName: String(storeName).trim(),
      storeType: String(storeType),
      marketLocation: marketLocation ? String(marketLocation).trim() : "",
      exactAddress: exactAddress ? String(exactAddress).trim() : "",
      dtiPermit: getUploadMeta(dtiPermitFile),
      validId: getUploadMeta(validIdFile),
      handleOwnDelivery: parsedHandleOwnDelivery,
      usePlatformRiders: parsedUsePlatformRiders,
      acceptTerms: parsedAcceptTerms,
      registrationStatus: "PENDING",
    });

    return res.status(201).json({
      message: "Registration successful! Waiting for approval.",
      user: {
        id: createdUser._id,
        name: createdUser.name,
        email: createdUser.email,
        role: createdUser.role,
      },
      seller: {
        id: sellerProfile._id,
        storeName: sellerProfile.storeName,
        storeType: sellerProfile.storeType,
        registrationStatus: sellerProfile.registrationStatus,
      },
    });
  } catch (error) {
    if (createdUser?._id) {
      await User.findByIdAndDelete(createdUser._id).catch(() => null);
    }

    return res.status(500).json({
      message: error.message || "Failed to register seller",
    });
  }
};

module.exports = {
  registerSeller,
};
