const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");

describe("Inventory source-of-truth and tenant isolation", () => {
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

  it("uses inventory as product stock/status source and blocks cross-tenant inventory access", async () => {
    await createSeller("Seller One", "seller1@example.com");
    await createSeller("Seller Two", "seller2@example.com");

    const sellerOneLogin = await login(
      "seller1@example.com",
      "SellerPass123!",
      "seller-1-device",
    );
    const sellerTwoLogin = await login(
      "seller2@example.com",
      "SellerPass123!",
      "seller-2-device",
    );

    expect(sellerOneLogin.statusCode).toBe(200);
    expect(sellerTwoLogin.statusCode).toBe(200);

    const productCreateRes = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${sellerOneLogin.body.accessToken}`)
      .send({
        name: "Cabbage",
        price: 80,
        stock: 12,
        unit: "kg",
        category: "vegetables",
      });

    expect(productCreateRes.statusCode).toBe(201);
    const productId = productCreateRes.body.product._id;

    const updateInventoryRes = await request(app)
      .patch(`/api/inventory/${productId}`)
      .set("Authorization", `Bearer ${sellerOneLogin.body.accessToken}`)
      .send({
        stock: 0,
      });

    expect(updateInventoryRes.statusCode).toBe(200);

    const mineProductsRes = await request(app)
      .get("/api/products/mine")
      .set("Authorization", `Bearer ${sellerOneLogin.body.accessToken}`);

    expect(mineProductsRes.statusCode).toBe(200);
    expect(mineProductsRes.body.products.length).toBe(1);
    expect(mineProductsRes.body.products[0].stock).toBe(0);
    expect(mineProductsRes.body.products[0].status).toBe("inactive");

    const storefrontRes = await request(app).get("/api/products?search=Cabbage");

    expect(storefrontRes.statusCode).toBe(200);
    expect(storefrontRes.body.products.length).toBe(0);

    const crossTenantInventoryRead = await request(app)
      .get(`/api/inventory/${productId}`)
      .set("Authorization", `Bearer ${sellerTwoLogin.body.accessToken}`);

    expect(crossTenantInventoryRead.statusCode).toBe(404);
  });
});
