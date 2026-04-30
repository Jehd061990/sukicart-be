const crypto = require("crypto");
const User = require("../models/User");
const Store = require("../models/Store");
const SellerProfile = require("../models/SellerProfile");
const POSSubscription = require("../models/POSSubscription");
const Session = require("../models/Session");
const ROLES = require("../constants/roles");

const DEFAULT_POS_SLOTS = 1;

const normalizeIdentifier = (value) => String(value || "").trim().toLowerCase();

const hashRefreshToken = (refreshToken) =>
  crypto.createHash("sha256").update(refreshToken).digest("hex");

const buildSessionDisplay = (sessionDoc) => ({
  id: sessionDoc._id,
  userId: sessionDoc.userId,
  role: sessionDoc.role,
  deviceId: sessionDoc.deviceId,
  deviceName: sessionDoc.deviceName || "",
  lastActiveAt: sessionDoc.lastActiveAt,
  ipAddress: sessionDoc.ipAddress || "",
  createdAt: sessionDoc.createdAt,
});

const resolveOwnerIdForUser = (user) =>
  user.role === ROLES.POS ? user.ownerId : user._id;

const ensureStoreForOwner = async (ownerUser) => {
  const existingStore = await Store.findOne({ ownerId: ownerUser._id });
  if (existingStore) {
    return existingStore;
  }

  const sellerProfile = await SellerProfile.findOne({ userId: ownerUser._id });
  const fallbackName = sellerProfile?.storeName || `${ownerUser.name}'s Store`;

  return Store.create({
    ownerId: ownerUser._id,
    sellerProfileId: sellerProfile?._id || null,
    name: fallbackName,
    isActive: true,
  });
};

const ensurePOSSubscriptionForOwner = async (ownerUser, store) => {
  const existing = await POSSubscription.findOne({ ownerId: ownerUser._id });
  if (existing) {
    if (!existing.storeId || String(existing.storeId) !== String(store._id)) {
      existing.storeId = store._id;
      await existing.save();
    }

    return existing;
  }

  return POSSubscription.create({
    ownerId: ownerUser._id,
    storeId: store._id,
    totalSlots: DEFAULT_POS_SLOTS,
  });
};

const getPOSUsage = async (ownerId) => {
  const activeCount = await Session.countDocuments({
    ownerId,
    role: ROLES.POS,
    revokedAt: null,
  });

  return activeCount;
};

const enforcePOSSlotPolicy = async ({ ownerId, subscription }) => {
  const activePOSSessions = await Session.find({
    ownerId,
    role: ROLES.POS,
    revokedAt: null,
  })
    .sort({ lastActiveAt: 1 })
    .select("_id")
    .lean();

  if (activePOSSessions.length < subscription.totalSlots) {
    return;
  }

  if (subscription.loginPolicy === "INVALIDATE_OLDEST") {
    const oldest = activePOSSessions[0];
    if (oldest?._id) {
      await Session.findByIdAndUpdate(oldest._id, {
        revokedAt: new Date(),
        lastActiveAt: new Date(),
      });
      return;
    }
  }

  const error = new Error(
    `POS slot limit reached (${activePOSSessions.length}/${subscription.totalSlots}). Please logout an active POS session or upgrade slots.`,
  );
  error.statusCode = 409;
  throw error;
};

const bindSessionOnLogin = async ({
  user,
  refreshToken,
  deviceId,
  deviceName,
  ipAddress,
}) => {
  const ownerId = resolveOwnerIdForUser(user);
  const ownerUser =
    user.role === ROLES.POS ? await User.findById(ownerId) : user;

  if (!ownerUser) {
    const error = new Error("Owner account not found");
    error.statusCode = 401;
    throw error;
  }

  const store = await ensureStoreForOwner(ownerUser);
  const subscription = await ensurePOSSubscriptionForOwner(ownerUser, store);

  if (user.role === ROLES.POS) {
    await Session.updateMany(
      {
        userId: user._id,
        revokedAt: null,
      },
      {
        revokedAt: new Date(),
      },
    );

    await enforcePOSSlotPolicy({ ownerId, subscription });
  }

  const sessionDoc = await Session.create({
    userId: user._id,
    ownerId,
    storeId: user.storeId || store._id,
    role: user.role,
    deviceId,
    deviceName: deviceName || "",
    ipAddress: ipAddress || "",
    refreshTokenHash: hashRefreshToken(refreshToken),
    lastActiveAt: new Date(),
  });

  return {
    sessionId: sessionDoc._id,
    store,
    subscription,
  };
};

const revokeSessionById = async (sessionId) => {
  await Session.findByIdAndUpdate(sessionId, {
    revokedAt: new Date(),
    lastActiveAt: new Date(),
  });
};

const rotateSessionRefreshToken = async (sessionId, refreshToken) => {
  await Session.findByIdAndUpdate(sessionId, {
    refreshTokenHash: hashRefreshToken(refreshToken),
    lastActiveAt: new Date(),
  });
};

const validateRefreshSession = async ({ sessionId, refreshToken, userId }) => {
  const sessionDoc = await Session.findById(sessionId);

  if (!sessionDoc || sessionDoc.revokedAt) {
    const error = new Error("Session is no longer active");
    error.statusCode = 401;
    throw error;
  }

  if (String(sessionDoc.userId) !== String(userId)) {
    const error = new Error("Session user mismatch");
    error.statusCode = 401;
    throw error;
  }

  const incomingHash = hashRefreshToken(refreshToken);
  if (incomingHash !== sessionDoc.refreshTokenHash) {
    const error = new Error("Refresh token has been revoked");
    error.statusCode = 401;
    throw error;
  }

  sessionDoc.lastActiveAt = new Date();
  await sessionDoc.save();

  return sessionDoc;
};

const touchSession = async (sessionId) => {
  if (!sessionId) {
    return;
  }

  await Session.findByIdAndUpdate(sessionId, {
    lastActiveAt: new Date(),
  });
};

const parseClientIp = (req) => {
  const xForwardedFor = String(req.headers["x-forwarded-for"] || "");
  if (xForwardedFor) {
    return xForwardedFor.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "";
};

const findUserByIdentifier = async (identifier) => {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) {
    return null;
  }

  return User.findOne({
    $or: [{ email: normalized }, { username: normalized }],
  }).select("+password");
};

module.exports = {
  buildSessionDisplay,
  bindSessionOnLogin,
  ensurePOSSubscriptionForOwner,
  ensureStoreForOwner,
  findUserByIdentifier,
  getPOSUsage,
  hashRefreshToken,
  parseClientIp,
  revokeSessionById,
  rotateSessionRefreshToken,
  touchSession,
  validateRefreshSession,
};
