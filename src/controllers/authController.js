const User = require("../models/User");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("../utils/jwtTokens");

const registerAllowedRoles = ["BUYER", "SELLER", "RIDER"];

const buildAuthPayload = (user) => ({
  id: user._id,
  role: user.role,
  tokenVersion: user.tokenVersion || 0,
});

const buildAuthResponse = (user, message) => {
  const authPayload = buildAuthPayload(user);
  const accessToken = generateAccessToken(authPayload);
  const refreshToken = generateRefreshToken(authPayload);

  return {
    message,
    accessToken,
    refreshToken,
    // Keep token for backward compatibility with existing frontend calls.
    token: accessToken,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    },
  };
};

const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        message: "name, email, password, and role are required",
      });
    }

    const normalizedRole = String(role).toUpperCase();
    if (!registerAllowedRoles.includes(normalizedRole)) {
      return res.status(400).json({
        message: "role must be one of BUYER, SELLER, RIDER",
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      role: normalizedRole,
      status: normalizedRole === "SELLER" ? "pending" : "active",
    });

    return res
      .status(201)
      .json(buildAuthResponse(user, "User registered successfully"));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password",
    );
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user.status !== "active") {
      return res
        .status(403)
        .json({
          message: `Account is ${user.status}. Please contact support.`,
        });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    return res.status(200).json(buildAuthResponse(user, "Login successful"));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: "refreshToken is required" });
    }

    const decoded = verifyRefreshToken(refreshToken);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    if (user.status !== "active") {
      return res
        .status(403)
        .json({
          message: `Account is ${user.status}. Please contact support.`,
        });
    }

    if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) {
      return res
        .status(401)
        .json({ message: "Refresh token has been revoked" });
    }

    return res
      .status(200)
      .json(buildAuthResponse(user, "Token refreshed successfully"));
  } catch (error) {
    return res.status(401).json({ message: "Invalid refresh token" });
  }
};

const getMe = async (req, res) => {
  return res.status(200).json({ user: req.user });
};

const logout = async (req, res) => {
  if (req.user) {
    req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
    await req.user.save();
  }

  return res.status(200).json({ message: "Logout successful" });
};

module.exports = {
  register,
  login,
  refresh,
  getMe,
  logout,
};
