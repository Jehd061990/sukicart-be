const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");
const Session = require("../src/models/Session");

describe("Auth refresh and logout session semantics", () => {
  let mongoServer;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test_access_secret";
    process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
    process.env.JWT_ACCESS_EXPIRES_IN = "15m";
    process.env.JWT_REFRESH_EXPIRES_IN = "7d";

    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterEach(async () => {
    const collections = await mongoose.connection.db.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  const createSeller = async () => {
    return User.create({
      name: "Seller Owner",
      email: "seller.owner@example.com",
      password: "SellerPass123!",
      role: "SELLER",
      status: "active",
    });
  };

  const login = async (identifier, deviceId, deviceName) => {
    return request(app).post("/api/auth/login").send({
      identifier,
      password: "SellerPass123!",
      deviceId,
      deviceName,
    });
  };

  it("rotates refresh token and rejects the previous refresh token", async () => {
    await createSeller();

    const loginRes = await login(
      "seller.owner@example.com",
      "seller-device-1",
      "Seller Device 1",
    );

    expect(loginRes.statusCode).toBe(200);
    const firstRefreshToken = loginRes.body.refreshToken;

    const refreshRes = await request(app).post("/api/auth/refresh").send({
      refreshToken: firstRefreshToken,
    });

    expect(refreshRes.statusCode).toBe(200);
    const secondRefreshToken = refreshRes.body.refreshToken;
    expect(secondRefreshToken).toBeTruthy();
    expect(secondRefreshToken).not.toBe(firstRefreshToken);

    const oldRefreshRes = await request(app).post("/api/auth/refresh").send({
      refreshToken: firstRefreshToken,
    });

    expect(oldRefreshRes.statusCode).toBe(401);
    expect(oldRefreshRes.body.message).toMatch(/Invalid refresh token/i);
  });

  it("rejects refresh token when session was revoked by logout", async () => {
    await createSeller();

    const loginRes = await login(
      "seller.owner@example.com",
      "seller-device-1",
      "Seller Device 1",
    );

    expect(loginRes.statusCode).toBe(200);

    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`);

    expect(logoutRes.statusCode).toBe(200);

    const refreshAfterLogoutRes = await request(app).post("/api/auth/refresh").send({
      refreshToken: loginRes.body.refreshToken,
    });

    expect(refreshAfterLogoutRes.statusCode).toBe(401);
    expect(refreshAfterLogoutRes.body.message).toMatch(/Invalid refresh token/i);
  });

  it("logs out only the current session and keeps other device sessions active", async () => {
    await createSeller();

    const loginResOne = await login(
      "seller.owner@example.com",
      "seller-device-1",
      "Seller Device 1",
    );
    const loginResTwo = await login(
      "seller.owner@example.com",
      "seller-device-2",
      "Seller Device 2",
    );

    expect(loginResOne.statusCode).toBe(200);
    expect(loginResTwo.statusCode).toBe(200);

    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${loginResOne.body.accessToken}`);

    expect(logoutRes.statusCode).toBe(200);

    const meWithLoggedOutSession = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginResOne.body.accessToken}`);

    expect(meWithLoggedOutSession.statusCode).toBe(401);

    const meWithActiveSession = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginResTwo.body.accessToken}`);

    expect(meWithActiveSession.statusCode).toBe(200);

    const sessionsRes = await request(app)
      .get("/api/sessions")
      .set("Authorization", `Bearer ${loginResTwo.body.accessToken}`);

    expect(sessionsRes.statusCode).toBe(200);
    expect(sessionsRes.body.data.length).toBeGreaterThanOrEqual(1);
    const activeDeviceIds = sessionsRes.body.data.map((session) => session.deviceId);
    expect(activeDeviceIds).toContain("seller-device-2");
    expect(activeDeviceIds).not.toContain("seller-device-1");

    const revokedSessionOne = await Session.findById(loginResOne.body.sessionId);
    expect(revokedSessionOne).toBeTruthy();
    expect(revokedSessionOne.revokedAt).toBeTruthy();

    const activeSessionTwo = await Session.findById(loginResTwo.body.sessionId);
    expect(activeSessionTwo).toBeTruthy();
    expect(activeSessionTwo.revokedAt).toBeNull();
  });
});
