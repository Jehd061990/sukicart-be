const jwt = require("jsonwebtoken");
const User = require("../models/User");
const ROLES = require("../constants/roles");

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Not authorized, token missing" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res
        .status(401)
        .json({ message: "Not authorized, user not found" });
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
const onlyAdmin = authorizeRoles(ROLES.ADMIN);

module.exports = {
  protect,
  authorizeRoles,
  onlySeller,
  onlyBuyer,
  onlyRider,
  onlyAdmin,
};
