const crypto = require("crypto");
const User = require("../models/User");
const Session = require("../models/Session");
const ROLES = require("../constants/roles");
const {
  buildSessionDisplay,
  ensurePOSSubscriptionForOwner,
  ensureStoreForOwner,
  getPOSUsage,
} = require("../services/sessionService");

const randomSuffix = (length = 6) =>
  crypto
    .randomBytes(length)
    .toString("hex")
    .slice(0, length);

const normalizeUsername = (username) =>
  String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");

const generateUsername = (owner) => {
  const base = normalizeUsername(owner.name).replace(/\./g, "") || "cashier";
  return `${base}.pos.${randomSuffix(5)}`;
};

const generatePassword = () => {
  const token = crypto.randomBytes(9).toString("base64url");
  return `${token}Aa1!`;
};

const createPOS = async (req, res) => {
  try {
    const owner = req.user;
    const { posName, username, password, autoGeneratePassword } = req.body;

    if (!posName || !String(posName).trim()) {
      return res.status(400).json({ message: "posName is required" });
    }

    const store = await ensureStoreForOwner(owner);
    const subscription = await ensurePOSSubscriptionForOwner(owner, store);

    const activePOSAccounts = await User.countDocuments({
      ownerId: owner._id,
      role: ROLES.POS,
      "posMeta.isPOSAccount": true,
      "posMeta.isDeactivated": false,
      status: "active",
    });

    if (activePOSAccounts >= subscription.totalSlots) {
      return res.status(409).json({
        message: `POS slot limit reached (${activePOSAccounts}/${subscription.totalSlots}). Upgrade your POS subscription to add more accounts.`,
      });
    }

    let normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      normalizedUsername = generateUsername(owner);
    }

    const usernameExists = await User.findOne({ username: normalizedUsername });
    if (usernameExists) {
      return res.status(409).json({ message: "Username is already in use" });
    }

    const needsGeneratedPassword = !password || autoGeneratePassword;
    const resolvedPassword = needsGeneratedPassword
      ? generatePassword()
      : String(password);

    if (resolvedPassword.length < 6) {
      return res.status(400).json({ message: "password must be at least 6 characters" });
    }

    const emailLocalPart = normalizedUsername.replace(/[^a-z0-9._-]/g, "");
    const syntheticEmail = `${emailLocalPart}.${randomSuffix(6)}@pos.sukicart.local`;

    const posUser = await User.create({
      name: String(posName).trim(),
      email: syntheticEmail,
      username: normalizedUsername,
      password: resolvedPassword,
      role: ROLES.POS,
      sellerId: owner._id,
      ownerId: owner._id,
      storeId: store._id,
      status: "active",
      posMeta: {
        posName: String(posName).trim(),
        isPOSAccount: true,
        isDeactivated: false,
      },
    });

    const activeUsage = await getPOSUsage(owner._id);

    return res.status(201).json({
      message: "POS account created successfully",
      pos: {
        id: posUser._id,
        posName: posUser.posMeta?.posName || posUser.name,
        username: posUser.username,
        status: posUser.status,
        isDeactivated: posUser.posMeta?.isDeactivated || false,
      },
      generatedPassword: needsGeneratedPassword ? resolvedPassword : undefined,
      usage: {
        active: activeUsage,
        total: subscription.totalSlots,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const listPOS = async (req, res) => {
  try {
    const owner = req.user;
    const store = await ensureStoreForOwner(owner);
    const subscription = await ensurePOSSubscriptionForOwner(owner, store);

    const posUsers = await User.find({
      ownerId: owner._id,
      role: ROLES.POS,
      "posMeta.isPOSAccount": true,
    })
      .sort({ createdAt: -1 })
      .select("name username status posMeta createdAt");

    const userIds = posUsers.map((user) => user._id);
    const activeSessions = await Session.find({
      userId: { $in: userIds },
      revokedAt: null,
    }).select("userId deviceId deviceName ipAddress lastActiveAt");

    const activeSessionByUser = new Map(
      activeSessions.map((sessionDoc) => [String(sessionDoc.userId), sessionDoc]),
    );

    const activeUsage = await getPOSUsage(owner._id);

    return res.status(200).json({
      usage: {
        active: activeUsage,
        total: subscription.totalSlots,
      },
      data: posUsers.map((user) => {
        const activeSession = activeSessionByUser.get(String(user._id));

        return {
          id: user._id,
          posName: user.posMeta?.posName || user.name,
          username: user.username,
          status: user.status,
          isDeactivated: user.posMeta?.isDeactivated || false,
          createdAt: user.createdAt,
          activeSession: activeSession ? buildSessionDisplay(activeSession) : null,
        };
      }),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const deactivatePOS = async (req, res) => {
  try {
    const owner = req.user;
    const posId = req.params.id;

    const posUser = await User.findOne({
      _id: posId,
      ownerId: owner._id,
      role: ROLES.POS,
      "posMeta.isPOSAccount": true,
    });

    if (!posUser) {
      return res.status(404).json({ message: "POS account not found" });
    }

    posUser.status = "inactive";
    posUser.isActive = false;
    posUser.posMeta.isDeactivated = true;
    await posUser.save();

    await Session.updateMany(
      {
        userId: posUser._id,
        revokedAt: null,
      },
      {
        revokedAt: new Date(),
        lastActiveAt: new Date(),
      },
    );

    return res.status(200).json({ message: "POS account deactivated" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updatePOS = async (req, res) => {
  try {
    const owner = req.user;
    const posId = req.params.id;
    const { posName, username, password } = req.body;

    const posUser = await User.findOne({
      _id: posId,
      ownerId: owner._id,
      role: ROLES.POS,
      "posMeta.isPOSAccount": true,
    }).select("+password");

    if (!posUser) {
      return res.status(404).json({ message: "POS account not found" });
    }

    const hasPosName = typeof posName === "string" && String(posName).trim();
    const hasUsername = typeof username === "string" && String(username).trim();
    const hasPassword = typeof password === "string" && String(password).trim();

    if (!hasPosName && !hasUsername && !hasPassword) {
      return res.status(400).json({
        message: "Provide at least one field to update: posName, username, or password",
      });
    }

    if (hasPosName) {
      const normalizedPosName = String(posName).trim();
      posUser.name = normalizedPosName;
      posUser.posMeta.posName = normalizedPosName;
    }

    if (hasUsername) {
      const normalizedUsername = normalizeUsername(username);
      if (!normalizedUsername) {
        return res.status(400).json({ message: "username is invalid" });
      }

      const duplicate = await User.findOne({
        _id: { $ne: posUser._id },
        username: normalizedUsername,
      });

      if (duplicate) {
        return res.status(409).json({ message: "Username is already in use" });
      }

      posUser.username = normalizedUsername;
    }

    if (hasPassword) {
      const normalizedPassword = String(password);
      if (normalizedPassword.length < 6) {
        return res.status(400).json({ message: "password must be at least 6 characters" });
      }

      posUser.password = normalizedPassword;
    }

    await posUser.save();

    return res.status(200).json({
      message: "POS account updated successfully",
      pos: {
        id: posUser._id,
        posName: posUser.posMeta?.posName || posUser.name,
        username: posUser.username,
        status: posUser.status,
        isDeactivated: posUser.posMeta?.isDeactivated || false,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const upgradePOSSlots = async (req, res) => {
  try {
    const owner = req.user;
    const { additionalSlots } = req.body;

    const parsedAdditionalSlots = Number(additionalSlots);
    if (
      !Number.isInteger(parsedAdditionalSlots) ||
      parsedAdditionalSlots <= 0 ||
      parsedAdditionalSlots > 100
    ) {
      return res.status(400).json({
        message: "additionalSlots must be an integer between 1 and 100",
      });
    }

    const store = await ensureStoreForOwner(owner);
    const subscription = await ensurePOSSubscriptionForOwner(owner, store);

    subscription.totalSlots += parsedAdditionalSlots;
    await subscription.save();

    const activeUsage = await getPOSUsage(owner._id);

    return res.status(200).json({
      message: `Subscription updated. ${parsedAdditionalSlots} POS slot(s) added successfully.`,
      subscription: {
        totalSlots: subscription.totalSlots,
        loginPolicy: subscription.loginPolicy,
      },
      usage: {
        active: activeUsage,
        total: subscription.totalSlots,
      },
      note: "This endpoint simulates a successful subscription upgrade. Connect payment provider for production billing.",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createPOS,
  listPOS,
  deactivatePOS,
  updatePOS,
  upgradePOSSlots,
};
