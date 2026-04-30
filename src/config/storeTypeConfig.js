const STORE_TYPES = {
  GROCERY: "grocery",
  PHARMACY: "pharmacy",
  HARDWARE: "hardware",
  CONVENIENCE: "convenience",
  RETAIL: "retail",
};

const STORE_TYPE_CONFIG = {
  [STORE_TYPES.GROCERY]: {
    label: "Grocery Store",
    modules: ["inventory", "sales", "discounts", "barcode"],
    features: {
      barcodeScanning: true,
      expiryTracking: false,
      prescriptionRequired: false,
      bulkQuantityInput: false,
    },
    requiredFields: {
      posOrder: [],
    },
    businessRules: {
      paymentMethods: ["cash"],
      maxLineItems: 200,
    },
    uiBehavior: {
      showPrescriptionInput: false,
      showBarcodeScanner: true,
      showBulkQuantityActions: false,
      scannerModes: ["hardware", "camera", "manual"],
      defaultScannerMode: "hardware",
    },
  },
  [STORE_TYPES.PHARMACY]: {
    label: "Pharmacy",
    modules: ["inventory", "sales", "prescriptions", "expiryTracking"],
    features: {
      barcodeScanning: true,
      expiryTracking: true,
      prescriptionRequired: true,
      bulkQuantityInput: false,
    },
    requiredFields: {
      posOrder: ["prescriptionCode"],
    },
    businessRules: {
      paymentMethods: ["cash"],
      maxLineItems: 120,
    },
    uiBehavior: {
      showPrescriptionInput: true,
      showBarcodeScanner: true,
      showBulkQuantityActions: false,
      scannerModes: ["hardware", "camera", "manual"],
      defaultScannerMode: "hardware",
    },
  },
  [STORE_TYPES.HARDWARE]: {
    label: "Hardware Store",
    modules: ["inventory", "sales", "barcode", "bulkPricing"],
    features: {
      barcodeScanning: true,
      expiryTracking: false,
      prescriptionRequired: false,
      bulkQuantityInput: true,
    },
    requiredFields: {
      posOrder: [],
    },
    businessRules: {
      paymentMethods: ["cash"],
      maxLineItems: 300,
    },
    uiBehavior: {
      showPrescriptionInput: false,
      showBarcodeScanner: true,
      showBulkQuantityActions: true,
      scannerModes: ["hardware", "camera", "manual"],
      defaultScannerMode: "hardware",
    },
  },
  [STORE_TYPES.CONVENIENCE]: {
    label: "Convenience Store",
    modules: ["inventory", "sales", "barcode", "promotions"],
    features: {
      barcodeScanning: true,
      expiryTracking: false,
      prescriptionRequired: false,
      bulkQuantityInput: false,
    },
    requiredFields: {
      posOrder: [],
    },
    businessRules: {
      paymentMethods: ["cash"],
      maxLineItems: 150,
    },
    uiBehavior: {
      showPrescriptionInput: false,
      showBarcodeScanner: true,
      showBulkQuantityActions: false,
      scannerModes: ["hardware", "camera", "manual"],
      defaultScannerMode: "hardware",
    },
  },
  [STORE_TYPES.RETAIL]: {
    label: "General Retail",
    modules: ["inventory", "sales", "discounts"],
    features: {
      barcodeScanning: false,
      expiryTracking: false,
      prescriptionRequired: false,
      bulkQuantityInput: false,
    },
    requiredFields: {
      posOrder: [],
    },
    businessRules: {
      paymentMethods: ["cash"],
      maxLineItems: 200,
    },
    uiBehavior: {
      showPrescriptionInput: false,
      showBarcodeScanner: false,
      showBulkQuantityActions: false,
      scannerModes: ["manual"],
      defaultScannerMode: "manual",
    },
  },
};

const LEGACY_TYPE_MAP = {
  gulay: STORE_TYPES.GROCERY,
  karne: STORE_TYPES.GROCERY,
  isda: STORE_TYPES.GROCERY,
  mixed: STORE_TYPES.RETAIL,
};

const deepMerge = (target, source) => {
  if (!source || typeof source !== "object") {
    return target;
  }

  const output = { ...target };

  Object.keys(source).forEach((key) => {
    const sourceValue = source[key];
    const targetValue = output[key];

    if (
      sourceValue &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      output[key] = deepMerge(targetValue, sourceValue);
      return;
    }

    output[key] = sourceValue;
  });

  return output;
};

const normalizeStoreType = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return STORE_TYPES.RETAIL;
  }

  if (STORE_TYPE_CONFIG[normalized]) {
    return normalized;
  }

  return LEGACY_TYPE_MAP[normalized] || STORE_TYPES.RETAIL;
};

const getStoreTypeConfig = (storeType, overrides = null) => {
  const normalizedType = normalizeStoreType(storeType);
  const baseConfig = STORE_TYPE_CONFIG[normalizedType] || STORE_TYPE_CONFIG[STORE_TYPES.RETAIL];
  return deepMerge(baseConfig, overrides || {});
};

const getSupportedStoreTypes = () => Object.values(STORE_TYPES);

module.exports = {
  STORE_TYPES,
  STORE_TYPE_CONFIG,
  getStoreTypeConfig,
  getSupportedStoreTypes,
  normalizeStoreType,
};