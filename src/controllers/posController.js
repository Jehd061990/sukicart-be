const Product = require("../models/Product");
const Order = require("../models/Order");
const Store = require("../models/Store");
const { Jimp } = require("jimp");
const ZXing = require("@zxing/library");
const ROLES = require("../constants/roles");
const { getStoreTypeConfig } = require("../config/storeTypeConfig");
const {
  mergeOrderItems,
  safeReduceStock,
  runInTransaction,
} = require("../utils/inventory");

const BARCODE_HINTS = new Map();
BARCODE_HINTS.set(ZXing.DecodeHintType.TRY_HARDER, true);
BARCODE_HINTS.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
  ZXing.BarcodeFormat.EAN_13,
  ZXing.BarcodeFormat.EAN_8,
  ZXing.BarcodeFormat.UPC_A,
  ZXing.BarcodeFormat.UPC_E,
  ZXing.BarcodeFormat.CODE_128,
  ZXing.BarcodeFormat.CODE_39,
  ZXing.BarcodeFormat.CODABAR,
  ZXing.BarcodeFormat.ITF,
]);

const normalizeBarcodeCandidate = (value) =>
  String(value || "")
    .replace(/\s+/g, "")
    .trim();

const isDigitsOnly = (value) => /^\d+$/.test(value);

const computeMod10CheckDigit = (body) => {
  let sum = 0;
  let positionFromRight = 0;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    const digit = Number(body[index]);
    sum += digit * (positionFromRight % 2 === 0 ? 3 : 1);
    positionFromRight += 1;
  }

  return (10 - (sum % 10)) % 10;
};

const isValidRetailChecksum = (value) => {
  if (!isDigitsOnly(value)) {
    return false;
  }

  if (![8, 12, 13].includes(value.length)) {
    return false;
  }

  const body = value.slice(0, -1);
  const checkDigit = Number(value[value.length - 1]);
  return computeMod10CheckDigit(body) === checkDigit;
};

const scoreCandidate = (candidate, count) => {
  let score = count;
  if (isDigitsOnly(candidate) && [8, 12, 13].includes(candidate.length)) {
    score += isValidRetailChecksum(candidate) ? 4 : -3;
  }

  return score;
};

const selectBestCandidate = (rawCandidates) => {
  const normalizedCandidates = rawCandidates
    .map((item) => normalizeBarcodeCandidate(item))
    .filter(Boolean);

  if (!normalizedCandidates.length) {
    return "";
  }

  const counts = new Map();
  for (const candidate of normalizedCandidates) {
    counts.set(candidate, (counts.get(candidate) || 0) + 1);
  }

  const ranked = Array.from(counts.entries())
    .map(([candidate, count]) => ({
      candidate,
      count,
      score: scoreCandidate(candidate, count),
      isChecksumValid: isValidRetailChecksum(candidate),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.count !== left.count) {
        return right.count - left.count;
      }

      if (right.isChecksumValid !== left.isChecksumValid) {
        return Number(right.isChecksumValid) - Number(left.isChecksumValid);
      }

      return right.candidate.length - left.candidate.length;
    });

  return ranked[0]?.candidate || "";
};

const readBarcodeFromBitmap = (bitmapData, useHybridBinarizer = true) => {
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(BARCODE_HINTS);

  const luminanceSource = new ZXing.RGBLuminanceSource(
    new Uint8ClampedArray(bitmapData.data),
    bitmapData.width,
    bitmapData.height,
  );

  const binarizer = useHybridBinarizer
    ? new ZXing.HybridBinarizer(luminanceSource)
    : new ZXing.GlobalHistogramBinarizer(luminanceSource);

  try {
    const binaryBitmap = new ZXing.BinaryBitmap(binarizer);
    const result = reader.decode(binaryBitmap);
    const text = String(result?.getText?.() || "").trim();
    return text;
  } catch {
    return "";
  } finally {
    reader.reset();
  }
};

const decodeBarcodeFromBuffer = async (buffer) => {
  const image = await Jimp.read(buffer);

  const variants = [
    image.clone(),
    image.clone().greyscale().contrast(0.35),
    image.clone().greyscale().normalize(),
  ];

  const candidates = [];

  for (const variant of variants) {
    const bitmap = variant.bitmap;
    const hybridText = readBarcodeFromBitmap(bitmap, true);
    if (hybridText) {
      candidates.push(hybridText);
    }

    const histogramText = readBarcodeFromBitmap(bitmap, false);
    if (histogramText) {
      candidates.push(histogramText);
    }
  }

  return selectBestCandidate(candidates);
};

const decodePOSFrameBarcode = async (req, res) => {
  try {
    const imageData = String(req.body?.imageData || "").trim();
    if (!imageData) {
      return res.status(400).json({ message: "imageData is required", barcode: null });
    }

    const base64Payload = imageData.includes(",")
      ? imageData.slice(imageData.indexOf(",") + 1)
      : imageData;

    const frameBuffer = Buffer.from(base64Payload, "base64");

    if (!frameBuffer.length) {
      return res.status(400).json({ message: "Invalid image payload", barcode: null });
    }

    const decoded = await decodeBarcodeFromBuffer(frameBuffer);

    if (!decoded) {
      return res.status(200).json({ message: "No barcode detected", barcode: null });
    }

    return res.status(200).json({ message: "Barcode decoded", barcode: decoded });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to decode barcode from frame",
      barcode: null,
      error: error.message,
    });
  }
};

const createPOSOrder = async (req, res) => {
  try {
    const { items, paymentMethod, prescriptionCode, scannedCode } = req.body;

    if (!paymentMethod || String(paymentMethod).toLowerCase() !== "cash") {
      return res.status(400).json({ message: "paymentMethod must be cash" });
    }

    const ownerId = req.user.role === ROLES.POS ? req.user.ownerId : req.user._id;
    const tenantStore = await Store.findOne({ ownerId }).select(
      "storeType configOverrides",
    );

    const resolvedConfig = getStoreTypeConfig(
      tenantStore?.storeType,
      tenantStore?.configOverrides,
    );

    const allowedPaymentMethods =
      resolvedConfig?.businessRules?.paymentMethods || ["cash"];

    if (!allowedPaymentMethods.includes(String(paymentMethod).toLowerCase())) {
      return res.status(400).json({
        message: `paymentMethod must be one of: ${allowedPaymentMethods.join(", ")}`,
      });
    }

    const requiredPosFields = resolvedConfig?.requiredFields?.posOrder || [];
    if (
      requiredPosFields.includes("prescriptionCode") &&
      !String(prescriptionCode || "").trim()
    ) {
      return res.status(400).json({
        message: "prescriptionCode is required for this store type",
      });
    }

    const maxLineItems = Number(resolvedConfig?.businessRules?.maxLineItems || 200);
    if (Array.isArray(items) && items.length > maxLineItems) {
      return res.status(400).json({
        message: `items exceeds maximum allowed line items (${maxLineItems})`,
      });
    }

    const order = await runInTransaction(async (session) => {
      const mergedItems = mergeOrderItems(items);
      const sellerIdForOrder = req.sellerId || req.user._id;
      const productIds = mergedItems.map((item) => item.productId);
      const products = await Product.find({
        _id: { $in: productIds },
        sellerId: sellerIdForOrder,
      }).session(session);

      if (products.length !== productIds.length) {
        const error = new Error("One or more products not found");
        error.statusCode = 404;
        throw error;
      }

      const productById = new Map(products.map((p) => [String(p._id), p]));
      const itemsForOrder = [];
      let total = 0;

      for (const mergedItem of mergedItems) {
        const product = productById.get(String(mergedItem.productId));

        if (String(product.sellerId) !== String(sellerIdForOrder)) {
          const error = new Error(
            `Forbidden: product ${product.name} does not belong to this seller`,
          );
          error.statusCode = 403;
          throw error;
        }

        const lineTotal = Number(
          (product.price * mergedItem.quantity).toFixed(2),
        );
        total += lineTotal;

        itemsForOrder.push({
          productId: product._id,
          sellerId: sellerIdForOrder,
          name: product.name,
          unit: product.unit,
          price: product.price,
          quantity: mergedItem.quantity,
          lineTotal,
        });
      }

      await safeReduceStock(session, itemsForOrder);

      const [createdOrder] = await Order.create(
        [
          {
            items: itemsForOrder,
            total: Number(total.toFixed(2)),
            buyerId: null,
            type: "POS",
            status: "pending",
            sellerId: sellerIdForOrder,
            posMetadata: {
              prescriptionCode: String(prescriptionCode || "").trim(),
              scannedCode: String(scannedCode || "").trim(),
            },
          },
        ],
        { session },
      );

      return createdOrder;
    });

    return res.status(201).json({
      message: "POS order created successfully",
      order,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message });
  }
};

module.exports = {
  createPOSOrder,
  decodePOSFrameBarcode,
};
