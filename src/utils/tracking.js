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

const buildTrackingPayload = (orderDoc) => {
  const order =
    typeof orderDoc?.toObject === "function" ? orderDoc.toObject() : orderDoc;

  const shouldHideLocations = isLocationHiddenStatus(order?.status);

  const targetLocation = isAfterPickup(order?.status)
    ? order?.buyerLocation
    : order?.sellerLocation;

  return {
    orderId: String(order?._id),
    status: order?.status,
    sellerLocation: shouldHideLocations ? null : order?.sellerLocation || null,
    buyerLocation: shouldHideLocations ? null : order?.buyerLocation || null,
    riderLocation: shouldHideLocations
      ? null
      : order?.riderLocation || order?.currentLocation || null,
    targetLocation: shouldHideLocations ? null : targetLocation || null,
    targetType: shouldHideLocations
      ? null
      : isAfterPickup(order?.status)
        ? "buyer"
        : "seller",
    riderId: order?.riderId ? String(order.riderId) : null,
    sellerId: order?.sellerId ? String(order.sellerId) : null,
    buyerId: order?.buyerId ? String(order.buyerId) : null,
    updatedAt: new Date().toISOString(),
  };
};

module.exports = {
  isAfterPickup,
  isLocationHiddenStatus,
  buildTrackingPayload,
};
