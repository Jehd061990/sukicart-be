const dotenv = require("dotenv");
const mongoose = require("mongoose");

const connectDB = require("../src/config/db");
const Product = require("../src/models/Product");

dotenv.config();

const API_BASE_URL = String(process.env.SMOKE_API_BASE_URL || "").trim();
const SELLER_IDENTIFIER = String(process.env.SMOKE_SELLER_IDENTIFIER || "").trim();
const SELLER_PASSWORD = String(process.env.SMOKE_SELLER_PASSWORD || "").trim();
const DEVICE_ID = String(process.env.SMOKE_DEVICE_ID || "migration-smoke-device").trim();

const logPass = (message) => console.log(`[PASS] ${message}`);
const logWarn = (message) => console.log(`[WARN] ${message}`);
const logFail = (message) => console.log(`[FAIL] ${message}`);

const runDatabaseChecks = async () => {
  const duplicateGroups = await Product.aggregate([
    { $match: { barcode: { $exists: true, $ne: "" } } },
    {
      $group: {
        _id: {
          sellerId: "$sellerId",
          barcode: "$barcode",
        },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (duplicateGroups.length > 0) {
    throw new Error(
      `Found ${duplicateGroups.length} duplicate barcode group(s) per seller`,
    );
  }

  logPass("No duplicate barcode groups per seller");

  const invalidExpiryDates = await Product.find({
    expiryDate: { $type: "string" },
  })
    .select("_id expiryDate")
    .limit(20)
    .lean();

  if (invalidExpiryDates.length > 0) {
    throw new Error(
      `Found ${invalidExpiryDates.length} product(s) with string expiryDate`,
    );
  }

  logPass("No string-based invalid expiryDate values");
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  let body = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return {
    status: response.status,
    ok: response.ok,
    body,
  };
};

const runApiChecks = async () => {
  if (!API_BASE_URL || !SELLER_IDENTIFIER || !SELLER_PASSWORD) {
    logWarn(
      "Skipping API checks. Set SMOKE_API_BASE_URL, SMOKE_SELLER_IDENTIFIER, and SMOKE_SELLER_PASSWORD to enable.",
    );
    return;
  }

  const loginRes = await fetchJson(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identifier: SELLER_IDENTIFIER,
      password: SELLER_PASSWORD,
      deviceId: DEVICE_ID,
    }),
  });

  if (!loginRes.ok || !loginRes.body?.accessToken) {
    throw new Error(
      `Seller login failed (${loginRes.status}): ${JSON.stringify(loginRes.body || {})}`,
    );
  }

  logPass("Seller login succeeded");

  const authHeaders = {
    Authorization: `Bearer ${loginRes.body.accessToken}`,
  };

  const storeConfigRes = await fetchJson(`${API_BASE_URL}/store-config/me`, {
    method: "GET",
    headers: authHeaders,
  });

  if (!storeConfigRes.ok || !storeConfigRes.body?.store?.id) {
    throw new Error(
      `Store config check failed (${storeConfigRes.status}): ${JSON.stringify(storeConfigRes.body || {})}`,
    );
  }

  logPass("Store config endpoint is healthy");

  const productsMineRes = await fetchJson(`${API_BASE_URL}/products/mine?page=1&limit=5`, {
    method: "GET",
    headers: authHeaders,
  });

  if (!productsMineRes.ok || !Array.isArray(productsMineRes.body?.products)) {
    throw new Error(
      `Products mine check failed (${productsMineRes.status}): ${JSON.stringify(productsMineRes.body || {})}`,
    );
  }

  logPass("Products mine endpoint is healthy");
};

const run = async () => {
  try {
    await connectDB();
    await runDatabaseChecks();
    await runApiChecks();

    console.log("Post-migration smoke test completed successfully.");
  } catch (error) {
    logFail(error.message || "Smoke test failed");
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
