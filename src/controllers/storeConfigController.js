const Store = require("../models/Store");
const {
  getStoreTypeConfig,
  getSupportedStoreTypes,
  normalizeStoreType,
} = require("../config/storeTypeConfig");
const { ensureStoreForOwner } = require("../services/sessionService");

const getOwnerIdFromRequest = (req) => {
  if (!req.user) {
    return null;
  }

  if (req.user.role === "POS") {
    return req.user.ownerId || req.sellerId || null;
  }

  return req.user._id;
};

const getMyStoreConfig = async (req, res) => {
  try {
    const ownerId = getOwnerIdFromRequest(req);
    if (!ownerId) {
      return res.status(400).json({ message: "Tenant owner could not be resolved" });
    }

    let store = await Store.findOne({ ownerId });
    if (!store && req.user.role === "SELLER") {
      store = await ensureStoreForOwner(req.user);
    }

    if (!store) {
      return res.status(404).json({ message: "Store not found for tenant" });
    }

    const normalizedStoreType = normalizeStoreType(store.storeType);
    if (normalizedStoreType !== store.storeType) {
      store.storeType = normalizedStoreType;
      await store.save();
    }

    const resolvedConfig = getStoreTypeConfig(store.storeType, store.configOverrides);

    return res.status(200).json({
      store: {
        id: store._id,
        name: store.name,
        storeType: store.storeType,
      },
      config: resolvedConfig,
      supportedStoreTypes: getSupportedStoreTypes(),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const updateMyStoreConfig = async (req, res) => {
  try {
    const ownerId = getOwnerIdFromRequest(req);
    if (!ownerId) {
      return res.status(400).json({ message: "Tenant owner could not be resolved" });
    }

    const store = await Store.findOne({ ownerId });
    if (!store) {
      return res.status(404).json({ message: "Store not found for tenant" });
    }

    const { storeType, configOverrides } = req.body || {};

    if (storeType !== undefined) {
      const normalizedType = normalizeStoreType(storeType);
      const supportedTypes = getSupportedStoreTypes();
      if (!supportedTypes.includes(normalizedType)) {
        return res.status(400).json({ message: "Invalid storeType" });
      }

      store.storeType = normalizedType;
    }

    if (configOverrides !== undefined) {
      const isValidOverrides =
        configOverrides === null ||
        (typeof configOverrides === "object" && !Array.isArray(configOverrides));

      if (!isValidOverrides) {
        return res.status(400).json({ message: "configOverrides must be an object or null" });
      }

      store.configOverrides = configOverrides;
    }

    await store.save();

    const resolvedConfig = getStoreTypeConfig(store.storeType, store.configOverrides);
    return res.status(200).json({
      message: "Store configuration updated",
      store: {
        id: store._id,
        name: store.name,
        storeType: store.storeType,
      },
      config: resolvedConfig,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getMyStoreConfig,
  updateMyStoreConfig,
};