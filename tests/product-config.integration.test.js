const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");

describe("Product config-driven validation and barcode uniqueness", () => {
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

  const createSeller = async (name, email) => {
    return User.create({
      name,
      email,
      password: "SellerPass123!",
      role: "SELLER",
      status: "active",
    });
  };

  const login = async (identifier, password, deviceId) => {
    return request(app).post("/api/auth/login").send({
      identifier,
      password,
      deviceId,
    });
  };

  it("requires expiryDate when tenant store type enables expiry tracking", async () => {
    await createSeller("Pharmacy Seller", "pharmacy@example.com");

    const sellerLogin = await login(
      "pharmacy@example.com",
      "SellerPass123!",
      "pharmacy-device",
    );

    expect(sellerLogin.statusCode).toBe(200);

    const setPharmacyConfigRes = await request(app)
      .patch("/api/store-config/me")
      .set("Authorization", `Bearer ${sellerLogin.body.accessToken}`)
      .send({
        storeType: "pharmacy",
      });

    expect(setPharmacyConfigRes.statusCode).toBe(200);

    const missingExpiryRes = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${sellerLogin.body.accessToken}`)
      .send({
        name: "Pain Reliever",
        price: 120,
        stock: 10,
        unit: "pcs",
        category: "fish",
        barcode: "RX-001",
      });

    expect(missingExpiryRes.statusCode).toBe(400);
    expect(missingExpiryRes.body.message).toMatch(/expiryDate is required/i);

    const withExpiryRes = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${sellerLogin.body.accessToken}`)
      .send({
        name: "Pain Reliever",
        price: 120,
        stock: 10,
        unit: "pcs",
        category: "fish",
        barcode: "RX-001",
        expiryDate: "2031-12-01",
      });

    expect(withExpiryRes.statusCode).toBe(201);
    expect(withExpiryRes.body.product.barcode).toBe("RX-001");
    expect(withExpiryRes.body.product.expiryDate).toBeTruthy();
  });

  it("enforces barcode uniqueness per tenant but allows same barcode across tenants", async () => {
    await createSeller("Seller One", "seller.one@example.com");
    await createSeller("Seller Two", "seller.two@example.com");

    const sellerOneLogin = await login(
      "seller.one@example.com",
      "SellerPass123!",
      "seller-one-device",
    );
    const sellerTwoLogin = await login(
      "seller.two@example.com",
      "SellerPass123!",
      "seller-two-device",
    );

    expect(sellerOneLogin.statusCode).toBe(200);
    expect(sellerTwoLogin.statusCode).toBe(200);

    const createFirstRes = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${sellerOneLogin.body.accessToken}`)
      .send({
        name: "Hammer",
        price: 250,
        stock: 8,
        unit: "pcs",
        category: "meat",
        barcode: "ABC-123",
      });

    expect(createFirstRes.statusCode).toBe(201);

    const duplicateSameTenantRes = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${sellerOneLogin.body.accessToken}`)
      .send({
        name: "Screwdriver",
        price: 120,
        stock: 7,
        unit: "pcs",
        category: "meat",
        barcode: "ABC-123",
      });

    expect(duplicateSameTenantRes.statusCode).toBe(409);
    expect(duplicateSameTenantRes.body.message).toMatch(/barcode already exists/i);

    const sameBarcodeOtherTenantRes = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${sellerTwoLogin.body.accessToken}`)
      .send({
        name: "Wrench",
        price: 180,
        stock: 5,
        unit: "pcs",
        category: "meat",
        barcode: "ABC-123",
      });

    expect(sameBarcodeOtherTenantRes.statusCode).toBe(201);
  });
});
