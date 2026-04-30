const dotenv = require("dotenv");
const mongoose = require("mongoose");

const connectDB = require("../src/config/db");
const Product = require("../src/models/Product");

dotenv.config();

const isDryRun = process.argv.includes("--dry-run");

const normalizeBarcode = (value) => String(value || "").trim();

const normalizeExpiryDate = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

const buildSanitizationOps = async () => {
  const cursor = Product.find({}).cursor();
  const ops = [];

  let visited = 0;
  let changed = 0;

  // Sanitize legacy values and ensure consistent defaults.
  for await (const product of cursor) {
    visited += 1;

    const nextBarcode = normalizeBarcode(product.barcode);
    const nextExpiryDate = normalizeExpiryDate(product.expiryDate);

    const barcodeChanged = (product.barcode || "") !== nextBarcode;
    const expiryChanged =
      Boolean(product.expiryDate) !== Boolean(nextExpiryDate) ||
      (product.expiryDate &&
        nextExpiryDate &&
        new Date(product.expiryDate).getTime() !== nextExpiryDate.getTime());

    if (!barcodeChanged && !expiryChanged) {
      continue;
    }

    changed += 1;
    ops.push({
      updateOne: {
        filter: { _id: product._id },
        update: {
          $set: {
            barcode: nextBarcode,
            expiryDate: nextExpiryDate,
          },
        },
      },
    });
  }

  return {
    ops,
    visited,
    changed,
  };
};

const buildDuplicateBarcodeFixOps = async () => {
  const duplicateGroups = await Product.aggregate([
    { $match: { barcode: { $exists: true, $ne: "" } } },
    {
      $group: {
        _id: {
          sellerId: "$sellerId",
          barcode: "$barcode",
        },
        ids: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  const ops = [];
  let clearedCount = 0;

  for (const group of duplicateGroups) {
    const [, ...duplicateIds] = group.ids;

    for (const duplicateId of duplicateIds) {
      clearedCount += 1;
      ops.push({
        updateOne: {
          filter: { _id: duplicateId },
          update: {
            $set: { barcode: "" },
          },
        },
      });
    }
  }

  return {
    ops,
    duplicateGroupCount: duplicateGroups.length,
    clearedCount,
  };
};

const run = async () => {
  try {
    await connectDB();

    console.log(
      `Starting product metadata backfill (${isDryRun ? "DRY RUN" : "LIVE RUN"})`,
    );

    const sanitize = await buildSanitizationOps();
    if (!isDryRun && sanitize.ops.length > 0) {
      await Product.bulkWrite(sanitize.ops, { ordered: false });
    }

    const duplicateFix = await buildDuplicateBarcodeFixOps();
    if (!isDryRun && duplicateFix.ops.length > 0) {
      await Product.bulkWrite(duplicateFix.ops, { ordered: false });
    }

    console.log(
      `Product metadata backfill ${isDryRun ? "dry run completed" : "completed"}.`,
    );
    console.log(`Visited products: ${sanitize.visited}`);
    console.log(
      `${isDryRun ? "Products to sanitize" : "Sanitized products"}: ${sanitize.changed}`,
    );
    console.log(`Duplicate barcode groups: ${duplicateFix.duplicateGroupCount}`);
    console.log(
      `${
        isDryRun
          ? "Duplicate barcode entries to clear"
          : "Duplicate barcode entries cleared"
      }: ${duplicateFix.clearedCount}`,
    );

    if (isDryRun) {
      console.log("No writes were made to the database.");
    }
  } catch (error) {
    console.error(`Backfill failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
