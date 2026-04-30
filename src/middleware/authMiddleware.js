const User = require("../models/User");
const Session = require("../models/Session");
const ROLES = require("../constants/roles");
const { verifyAccessToken } = require("../utils/jwtTokens");
const { touchSession } = require("../services/sessionService");

const resolveSellerIdForUser = (user) => {
  if (!user) {
    return null;
  }

  if (user.role === ROLES.SELLER) {
    return user.sellerId || user._id;
  }

  if (user.role === ROLES.POS) {
    return user.sellerId || user.ownerId || null;
  }

  return null;
};

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Not authorized, token missing" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyAccessToken(token);

    if (decoded.sessionId) {
      const sessionDoc = await Session.findById(decoded.sessionId).select(
        "_id revokedAt userId",
      );

      if (!sessionDoc || sessionDoc.revokedAt) {
        return res.status(401).json({ message: "Session expired or revoked" });
      }

      if (String(sessionDoc.userId) !== String(decoded.id)) {
        return res.status(401).json({ message: "Session validation failed" });
      }
    }

    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res
        .status(401)
        .json({ message: "Not authorized, user not found" });
    }

    if (user.status !== "active") {
      return res
        .status(403)
        .json({
          message: `Account is ${user.status}. Please contact support.`,
        });
    }

    req.user = user;
    const resolvedSellerId = resolveSellerIdForUser(user);

    if (
      [ROLES.SELLER, ROLES.POS].includes(user.role) &&
      (!resolvedSellerId ||
        String(decoded.sellerId || "") !== String(resolvedSellerId))
    ) {
      return res.status(401).json({ message: "Tenant validation failed" });
    }

    req.sellerId = resolvedSellerId ? String(resolvedSellerId) : null;
    req.auth = {
      sessionId: decoded.sessionId || null,
      sellerId: decoded.sellerId || null,
    };

    await touchSession(decoded.sessionId || null);
    next();
  } catch (error) {
    return res.status(401).json({ message: "Not authorized, invalid token" });
  }
};

const authorizeRoles = (...allowedRoles) => {
  const normalizedRoles = allowedRoles.map((role) =>
    String(role).toUpperCase(),
  );

  return (req, res, next) => {
    if (!req.user || !normalizedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden: insufficient role" });
    }
    next();
  };
};

const onlySeller = authorizeRoles(ROLES.SELLER);
const onlyPOS = authorizeRoles(ROLES.POS);
const onlyBuyer = authorizeRoles(ROLES.BUYER);
const onlyRider = authorizeRoles(ROLES.RIDER);
const requireAdmin = authorizeRoles(ROLES.ADMIN);

// Backward-compatible aliases
const protect = requireAuth;
const onlyAdmin = requireAdmin;

module.exports = {
  requireAuth,
  requireAdmin,
  protect,
  authorizeRoles,
  onlySeller,
  onlyPOS,
  onlyBuyer,
  onlyRider,
  onlyAdmin,
};
