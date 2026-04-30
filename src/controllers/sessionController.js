const Session = require("../models/Session");
const ROLES = require("../constants/roles");
const { buildSessionDisplay } = require("../services/sessionService");

const listSessions = async (req, res) => {
  try {
    const isOwner = req.user.role === ROLES.SELLER;
    const ownerId = isOwner ? req.user._id : req.user.ownerId || req.user._id;

    const query = {
      ownerId,
      revokedAt: null,
    };

    if (req.user.role === ROLES.POS) {
      query.userId = req.user._id;
    }

    const sessions = await Session.find(query)
      .sort({ lastActiveAt: -1 })
      .select("userId role deviceId deviceName ipAddress lastActiveAt createdAt");

    return res.status(200).json({
      data: sessions.map((sessionDoc) => buildSessionDisplay(sessionDoc)),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const forceLogoutSession = async (req, res) => {
  try {
    const ownerId = req.user.role === ROLES.POS ? req.user.ownerId : req.user._id;
    const sessionId = req.params.id;

    const sessionDoc = await Session.findOne({
      _id: sessionId,
      ownerId,
      revokedAt: null,
    });

    if (!sessionDoc) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (req.user.role === ROLES.POS && String(sessionDoc.userId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    sessionDoc.revokedAt = new Date();
    sessionDoc.lastActiveAt = new Date();
    await sessionDoc.save();

    return res.status(200).json({ message: "Session revoked successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  listSessions,
  forceLogoutSession,
};
