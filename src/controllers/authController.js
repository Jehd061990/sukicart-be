const User = require("../models/User");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("../utils/jwtTokens");
const {
  bindSessionOnLogin,
  findUserByIdentifier,
  getPOSUsage,
  parseClientIp,
  revokeSessionById,
  rotateSessionRefreshToken,
  validateRefreshSession,
} = require("../services/sessionService");
const crypto = require("crypto");

const registerAllowedRoles = ["BUYER", "SELLER", "RIDER"];

const buildAuthPayload = (user, sessionId, nonce) => ({
  id: user._id,
  role: user.role,
  tokenVersion: user.tokenVersion || 0,
  sessionId,
  nonce,
});

const buildAuthResponse = ({ user, message, sessionId, posUsage }) => {
  const authPayload = buildAuthPayload(user, sessionId, crypto.randomUUID());
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
      username: user.username,
      role: user.role,
      status: user.status,
    },
    sessionId,
    posUsage,
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

    return res.status(201).json(
      buildAuthResponse({
        user,
        message: "User registered successfully",
        sessionId: null,
      }),
    );
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, identifier, password, deviceId, deviceName } = req.body;
    const resolvedIdentifier = identifier || email;
    const fallbackDeviceId = crypto
      .createHash("sha1")
      .update(`${parseClientIp(req)}:${req.headers["user-agent"] || "unknown"}`)
      .digest("hex")
      .slice(0, 32);
    const resolvedDeviceId = deviceId || fallbackDeviceId;

    if (!resolvedIdentifier || !password) {
      return res
        .status(400)
        .json({ message: "identifier and password are required" });
    }

    const user = await findUserByIdentifier(resolvedIdentifier);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user.role === "POS" && user.posMeta?.isDeactivated) {
      return res.status(403).json({ message: "POS account is deactivated" });
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

    const ownerId = user.role === "POS" ? user.ownerId : user._id;
    if (user.role === "POS" && !ownerId) {
      return res.status(400).json({ message: "POS owner account not configured" });
    }

    const prePayload = {
      id: user._id,
      role: user.role,
      tokenVersion: user.tokenVersion || 0,
      sessionId: "pending",
    };
    const preRefreshToken = generateRefreshToken(prePayload);

    const sessionBind = await bindSessionOnLogin({
      user,
      refreshToken: preRefreshToken,
      deviceId: resolvedDeviceId,
      deviceName,
      ipAddress: parseClientIp(req),
    });

    const response = buildAuthResponse({
      user,
      message: "Login successful",
      sessionId: sessionBind.sessionId,
    });

    await rotateSessionRefreshToken(sessionBind.sessionId, response.refreshToken);

    const subscription = sessionBind.subscription;
    const activeCount = await getPOSUsage(ownerId);

    return res.status(200).json({
      ...response,
      posUsage: {
        active: activeCount,
        total: subscription.totalSlots,
      },
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ message: error.message });
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

    if (decoded.sessionId) {
      await validateRefreshSession({
        sessionId: decoded.sessionId,
        refreshToken,
        userId: user._id,
      });
    }

    const response = buildAuthResponse({
      user,
      message: "Token refreshed successfully",
      sessionId: decoded.sessionId,
    });

    if (decoded.sessionId) {
      await rotateSessionRefreshToken(decoded.sessionId, response.refreshToken);
    }

    return res.status(200).json(response);
  } catch (error) {
    return res
      .status(error.statusCode || 401)
      .json({ message: "Invalid refresh token" });
  }
};

const getMe = async (req, res) => {
  return res.status(200).json({ user: req.user });
};

const logout = async (req, res) => {
  if (req.auth?.sessionId) {
    await revokeSessionById(req.auth.sessionId);
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
