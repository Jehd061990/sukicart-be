const User = require("../models/User");
const ROLES = require("../constants/roles");
const { verifyAccessToken } = require("../utils/jwtTokens");

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Not authorized, token missing" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyAccessToken(token);

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
  onlyBuyer,
  onlyRider,
  onlyAdmin,
};
