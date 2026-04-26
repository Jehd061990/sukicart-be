const isAfterPickup = (status) =>
  ["picked_up", "out_for_delivery", "arrived_at_buyer", "delivered"].includes(
    String(status),
  );

const HIDE_LOCATION_STATUSES = [
  "delivered",
  "completed",
  "cancelled_by_buyer",
  "declined_by_seller",
];

const isLocationHiddenStatus = (status) =>
  HIDE_LOCATION_STATUSES.includes(String(status));

const getViewer = (viewer) => {
  if (!viewer || typeof viewer !== "object") {
    return { id: "", role: "" };
  }

  return {
    id: String(viewer.id || viewer._id || ""),
    role: String(viewer.role || "").toUpperCase(),
  };
};

const buildTrackingPayload = (orderDoc, viewer = null) => {
  const order =
    typeof orderDoc?.toObject === "function" ? orderDoc.toObject() : orderDoc;

  const shouldHideLocations = isLocationHiddenStatus(order?.status);
  const { id: viewerId, role: viewerRole } = getViewer(viewer);

  const targetLocation = isAfterPickup(order?.status)
    ? order?.buyerLocation
    : order?.sellerLocation;

  const fullPayload = {
    orderId: String(order?._id),
    status: order?.status,
    sellerLocation: order?.sellerLocation || null,
    buyerLocation: order?.buyerLocation || null,
    riderLocation: order?.riderLocation || order?.currentLocation || null,
    targetLocation: targetLocation || null,
    targetType: isAfterPickup(order?.status) ? "buyer" : "seller",
    riderId: order?.riderId ? String(order.riderId) : null,
    sellerId: order?.sellerId ? String(order.sellerId) : null,
    buyerId: order?.buyerId ? String(order.buyerId) : null,
    updatedAt: new Date().toISOString(),
  };

  if (!shouldHideLocations) {
    return fullPayload;
  }

  if (viewerRole === "ADMIN") {
    return fullPayload;
  }

  const buyerId = fullPayload.buyerId;
  const sellerId = fullPayload.sellerId;
  const riderId = fullPayload.riderId;

  const hiddenPayload = {
    ...fullPayload,
    sellerLocation: null,
    buyerLocation: null,
    riderLocation: null,
    targetLocation: null,
    targetType: null,
  };

  if (viewerRole === "BUYER" && buyerId && viewerId === buyerId) {
    hiddenPayload.buyerLocation = fullPayload.buyerLocation;
    hiddenPayload.targetLocation = fullPayload.buyerLocation;
    hiddenPayload.targetType = "buyer";
  }

  if (viewerRole === "SELLER" && sellerId && viewerId === sellerId) {
    hiddenPayload.sellerLocation = fullPayload.sellerLocation;
    hiddenPayload.targetLocation = fullPayload.sellerLocation;
    hiddenPayload.targetType = "seller";
  }

  if (viewerRole === "RIDER" && riderId && viewerId === riderId) {
    hiddenPayload.riderLocation = fullPayload.riderLocation;
    hiddenPayload.targetLocation = fullPayload.riderLocation;
  }

  return hiddenPayload;
};

module.exports = {
  isAfterPickup,
  isLocationHiddenStatus,
  buildTrackingPayload,
};
