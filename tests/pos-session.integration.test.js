const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");
const Store = require("../src/models/Store");
const POSSubscription = require("../src/models/POSSubscription");
const Session = require("../src/models/Session");

describe("POS session controls", () => {
  let mongoServer;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test_access_secret";
    process.env.JWT_REFRESH_SECRET = "test_refresh_secret";
    process.env.JWT_ACCESS_EXPIRES_IN = "15m";
    process.env.JWT_REFRESH_EXPIRES_IN = "7d";

    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
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

  const createOwnerAndStore = async () => {
    const owner = await User.create({
      name: "Owner One",
      email: "owner@example.com",
      password: "OwnerPass123!",
      role: "SELLER",
      status: "active",
    });

    const store = await Store.create({
      ownerId: owner._id,
      name: "Owner One Store",
      isActive: true,
    });

    return { owner, store };
  };

  it("allows POS relogin on a new device by replacing its previous active session", async () => {
    const { owner, store } = await createOwnerAndStore();

    await POSSubscription.create({
      ownerId: owner._id,
      storeId: store._id,
      totalSlots: 1,
      loginPolicy: "REJECT",
    });

    const posUser = await User.create({
      name: "Cashier 1",
      email: "cashier1@example.com",
      username: "cashier1",
      password: "PosPass123!",
      role: "POS",
      status: "active",
      ownerId: owner._id,
      storeId: store._id,
      posMeta: {
        posName: "Cashier 1",
        isPOSAccount: true,
        isDeactivated: false,
      },
    });

    const loginOne = await request(app).post("/api/auth/login").send({
      identifier: "cashier1",
      password: "PosPass123!",
      deviceId: "device-a",
      deviceName: "Device A",
    });

    expect(loginOne.statusCode).toBe(200);

    const loginTwo = await request(app).post("/api/auth/login").send({
      identifier: "cashier1",
      password: "PosPass123!",
      deviceId: "device-b",
      deviceName: "Device B",
    });

    expect(loginTwo.statusCode).toBe(200);

    const activeSessions = await Session.find({
      userId: posUser._id,
      revokedAt: null,
    });

    expect(activeSessions).toHaveLength(1);
    expect(activeSessions[0].deviceId).toBe("device-b");
  });

  it("rejects a new POS login when slot limit is reached and policy is REJECT", async () => {
    const { owner, store } = await createOwnerAndStore();

    await POSSubscription.create({
      ownerId: owner._id,
      storeId: store._id,
      totalSlots: 1,
      loginPolicy: "REJECT",
    });

    await User.create({
      name: "Cashier 1",
      email: "cashier1@example.com",
      username: "cashier1",
      password: "PosPass123!",
      role: "POS",
      status: "active",
      ownerId: owner._id,
      storeId: store._id,
      posMeta: {
        posName: "Cashier 1",
        isPOSAccount: true,
        isDeactivated: false,
      },
    });

    await User.create({
      name: "Cashier 2",
      email: "cashier2@example.com",
      username: "cashier2",
      password: "PosPass123!",
      role: "POS",
      status: "active",
      ownerId: owner._id,
      storeId: store._id,
      posMeta: {
        posName: "Cashier 2",
        isPOSAccount: true,
        isDeactivated: false,
      },
    });

    const firstLogin = await request(app).post("/api/auth/login").send({
      identifier: "cashier1",
      password: "PosPass123!",
      deviceId: "device-a",
    });

    expect(firstLogin.statusCode).toBe(200);

    const secondLogin = await request(app).post("/api/auth/login").send({
      identifier: "cashier2",
      password: "PosPass123!",
      deviceId: "device-b",
    });

    expect(secondLogin.statusCode).toBe(409);
    expect(secondLogin.body.message).toMatch(/POS slot limit reached/i);
  });

  it("invalidates oldest POS session when login policy is INVALIDATE_OLDEST", async () => {
    const { owner, store } = await createOwnerAndStore();

    await POSSubscription.create({
      ownerId: owner._id,
      storeId: store._id,
      totalSlots: 1,
      loginPolicy: "INVALIDATE_OLDEST",
    });

    const pos1 = await User.create({
      name: "Cashier 1",
      email: "cashier1@example.com",
      username: "cashier1",
      password: "PosPass123!",
      role: "POS",
      status: "active",
      ownerId: owner._id,
      storeId: store._id,
      posMeta: {
        posName: "Cashier 1",
        isPOSAccount: true,
        isDeactivated: false,
      },
    });

    const pos2 = await User.create({
      name: "Cashier 2",
      email: "cashier2@example.com",
      username: "cashier2",
      password: "PosPass123!",
      role: "POS",
      status: "active",
      ownerId: owner._id,
      storeId: store._id,
      posMeta: {
        posName: "Cashier 2",
        isPOSAccount: true,
        isDeactivated: false,
      },
    });

    const firstLogin = await request(app).post("/api/auth/login").send({
      identifier: "cashier1",
      password: "PosPass123!",
      deviceId: "device-a",
    });

    expect(firstLogin.statusCode).toBe(200);

    const secondLogin = await request(app).post("/api/auth/login").send({
      identifier: "cashier2",
      password: "PosPass123!",
      deviceId: "device-b",
    });

    expect(secondLogin.statusCode).toBe(200);

    const activeSessions = await Session.find({
      ownerId: owner._id,
      role: "POS",
      revokedAt: null,
    });

    expect(activeSessions).toHaveLength(1);
    expect(String(activeSessions[0].userId)).toBe(String(pos2._id));

    const revokedFirst = await Session.findOne({
      ownerId: owner._id,
      userId: pos1._id,
      role: "POS",
      revokedAt: { $ne: null },
    });

    expect(revokedFirst).toBeTruthy();
  });
});
