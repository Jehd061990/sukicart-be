const User = require("../models/User");
const BuyerProfile = require("../models/BuyerProfile");

const registerBuyer = async (req, res) => {
  let createdUser = null;

  try {
    const {
      fullName,
      phoneNumber,
      email,
      password,
      city,
      barangay,
      streetAddress,
      landmark,
      notes,
    } = req.body;

    if (!fullName || !phoneNumber || !password || !barangay || !streetAddress) {
      return res.status(400).json({
        message:
          "fullName, phoneNumber, password, barangay, and streetAddress are required",
      });
    }

    // Frontend allows optional email. Use a deterministic placeholder when absent.
    const normalizedEmail = email
      ? String(email).toLowerCase().trim()
      : `buyer_${Date.now()}_${Math.floor(Math.random() * 100000)}@placeholder.local`;

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    createdUser = await User.create({
      name: String(fullName).trim(),
      email: normalizedEmail,
      password,
      role: "BUYER",
      status: "active",
    });

    const buyerProfile = await BuyerProfile.create({
      userId: createdUser._id,
      fullName: String(fullName).trim(),
      phoneNumber: String(phoneNumber).trim(),
      city: city ? String(city).trim() : "Davao",
      barangay: String(barangay).trim(),
      streetAddress: String(streetAddress).trim(),
      landmark: landmark ? String(landmark).trim() : "",
      notes: notes ? String(notes).trim() : "",
    });

    return res.status(201).json({
      message: "Welcome! Start shopping now.",
      user: {
        id: createdUser._id,
        name: createdUser.name,
        email: email ? createdUser.email : null,
        role: createdUser.role,
      },
      buyer: {
        id: buyerProfile._id,
        city: buyerProfile.city,
        barangay: buyerProfile.barangay,
        streetAddress: buyerProfile.streetAddress,
      },
    });
  } catch (error) {
    if (createdUser?._id) {
      await User.findByIdAndDelete(createdUser._id).catch(() => null);
    }

    return res
      .status(500)
      .json({ message: error.message || "Failed to register buyer" });
  }
};

module.exports = {
  registerBuyer,
};
