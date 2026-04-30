const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");
const Store = require("../src/models/Store");
const POSSubscription = require("../src/models/POSSubscription");
const Session = require("../src/models/Session");

describe("POS management and session endpoints", () => {
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

  const createSellerAndLogin = async () => {
    const seller = await User.create({
      name: "Seller Owner",
      email: "seller.owner@example.com",
      password: "SellerPass123!",
      role: "SELLER",
      status: "active",
    });

    const store = await Store.create({
      ownerId: seller._id,
      name: "Owner Store",
      isActive: true,
    });

    await POSSubscription.create({
      ownerId: seller._id,
      storeId: store._id,
      totalSlots: 3,
      loginPolicy: "REJECT",
    });

    const loginRes = await request(app).post("/api/auth/login").send({
      identifier: seller.email,
      password: "SellerPass123!",
      deviceId: "seller-device-1",
      deviceName: "Seller Laptop",
    });

    expect(loginRes.statusCode).toBe(200);

    return {
      seller,
      store,
      accessToken: loginRes.body.accessToken,
    };
  };

  it("creates POS account, logs in POS, lists sessions, and force logs out POS session", async () => {
    const { accessToken } = await createSellerAndLogin();

    const createPOSRes = await request(app)
      .post("/api/pos/create")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        posName: "Cashier 1",
        username: "cashier.one",
        password: "PosPass123!",
      });

    expect(createPOSRes.statusCode).toBe(201);
    expect(createPOSRes.body.pos.username).toBe("cashier.one");
    expect(createPOSRes.body.usage.total).toBe(3);

    const posLoginRes = await request(app).post("/api/auth/login").send({
      identifier: "cashier.one",
      password: "PosPass123!",
      deviceId: "pos-device-1",
      deviceName: "Cashier Tablet",
    });

    expect(posLoginRes.statusCode).toBe(200);
    const posSessionId = posLoginRes.body.sessionId;
    expect(posSessionId).toBeTruthy();

    const listSessionsRes = await request(app)
      .get("/api/sessions")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(listSessionsRes.statusCode).toBe(200);
    const foundPOSSession = listSessionsRes.body.data.find(
      (session) => session.id === posSessionId,
    );
    expect(foundPOSSession).toBeTruthy();

    const forceLogoutRes = await request(app)
      .delete(`/api/sessions/${posSessionId}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(forceLogoutRes.statusCode).toBe(200);

    const revokedSession = await Session.findById(posSessionId);
    expect(revokedSession).toBeTruthy();
    expect(revokedSession.revokedAt).toBeTruthy();
  });

  it("deactivates POS account and revokes active POS sessions", async () => {
    const { accessToken } = await createSellerAndLogin();

    const createPOSRes = await request(app)
      .post("/api/pos/create")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        posName: "Cashier 2",
        username: "cashier.two",
        password: "PosPass123!",
      });

    expect(createPOSRes.statusCode).toBe(201);
    const posUserId = createPOSRes.body.pos.id;

    const posLoginRes = await request(app).post("/api/auth/login").send({
      identifier: "cashier.two",
      password: "PosPass123!",
      deviceId: "pos-device-2",
      deviceName: "Cashier Phone",
    });

    expect(posLoginRes.statusCode).toBe(200);

    const deactivateRes = await request(app)
      .delete(`/api/pos/${posUserId}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(deactivateRes.statusCode).toBe(200);

    const posUser = await User.findById(posUserId);
    expect(posUser.status).toBe("inactive");
    expect(posUser.posMeta.isDeactivated).toBe(true);

    const activeSessions = await Session.find({
      userId: posUserId,
      revokedAt: null,
    });

    expect(activeSessions).toHaveLength(0);
  });

  it("prevents POS role from deactivating accounts through seller-only endpoint", async () => {
    const { accessToken } = await createSellerAndLogin();

    const createPOSRes = await request(app)
      .post("/api/pos/create")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        posName: "Cashier 3",
        username: "cashier.three",
        password: "PosPass123!",
      });

    expect(createPOSRes.statusCode).toBe(201);
    const posUserId = createPOSRes.body.pos.id;

    const posLoginRes = await request(app).post("/api/auth/login").send({
      identifier: "cashier.three",
      password: "PosPass123!",
      deviceId: "pos-device-3",
      deviceName: "Cashier Device",
    });

    expect(posLoginRes.statusCode).toBe(200);

    const forbiddenRes = await request(app)
      .delete(`/api/pos/${posUserId}`)
      .set("Authorization", `Bearer ${posLoginRes.body.accessToken}`);

    expect(forbiddenRes.statusCode).toBe(403);
  });
});
