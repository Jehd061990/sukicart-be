const mongoose = require("mongoose");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");

describe("Tenant isolation across sellers", () => {
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

  it("blocks seller cross-tenant product updates and isolates POS product views", async () => {
    const sellerOne = await createSeller("Seller One", "seller1@example.com");
    const sellerTwo = await createSeller("Seller Two", "seller2@example.com");

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

    const tokenPayload = jwt.verify(
      sellerOneLogin.body.accessToken,
      process.env.JWT_SECRET,
    );
    expect(String(tokenPayload.sellerId)).toBe(String(sellerOne._id));

    const productCreateRes = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${sellerOneLogin.body.accessToken}`)
      .send({
        name: "Tomato Seller One",
        price: 55,
        stock: 20,
        unit: "kg",
        category: "vegetables",
      });

    expect(productCreateRes.statusCode).toBe(201);
    const sellerOneProductId = productCreateRes.body.product._id;

    const crossTenantUpdateRes = await request(app)
      .put(`/api/products/${sellerOneProductId}`)
      .set("Authorization", `Bearer ${sellerTwoLogin.body.accessToken}`)
      .send({
        price: 99,
      });

    // Return 404 instead of 403 to avoid exposing resource existence across tenants.
    expect(crossTenantUpdateRes.statusCode).toBe(404);

    const posOne = await User.create({
      name: "POS One",
      email: "pos1@example.com",
      username: "pos.one",
      password: "PosPass123!",
      role: "POS",
      status: "active",
      ownerId: sellerOne._id,
      sellerId: sellerOne._id,
      posMeta: {
        posName: "POS One",
        isPOSAccount: true,
        isDeactivated: false,
      },
    });

    const posTwo = await User.create({
      name: "POS Two",
      email: "pos2@example.com",
      username: "pos.two",
      password: "PosPass123!",
      role: "POS",
      status: "active",
      ownerId: sellerTwo._id,
      sellerId: sellerTwo._id,
      posMeta: {
        posName: "POS Two",
        isPOSAccount: true,
        isDeactivated: false,
      },
    });

    const posOneLogin = await login("pos.one", "PosPass123!", "pos-1-device");
    const posTwoLogin = await login("pos.two", "PosPass123!", "pos-2-device");

    expect(posOneLogin.statusCode).toBe(200);
    expect(posTwoLogin.statusCode).toBe(200);

    const posOneProducts = await request(app)
      .get("/api/products/mine")
      .set("Authorization", `Bearer ${posOneLogin.body.accessToken}`);

    const posTwoProducts = await request(app)
      .get("/api/products/mine")
      .set("Authorization", `Bearer ${posTwoLogin.body.accessToken}`);

    expect(posOneProducts.statusCode).toBe(200);
    expect(posTwoProducts.statusCode).toBe(200);

    expect(posOneProducts.body.products.length).toBe(1);
    expect(posOneProducts.body.products[0].name).toBe("Tomato Seller One");

    expect(posTwoProducts.body.products.length).toBe(0);

    const posTokenPayload = jwt.verify(
      posOneLogin.body.accessToken,
      process.env.JWT_SECRET,
    );
    expect(String(posTokenPayload.sellerId)).toBe(String(posOne.sellerId));
    expect(String(posTokenPayload.sellerId)).not.toBe(String(posTwo.sellerId));
  });
});
