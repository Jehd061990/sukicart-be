const isAfterPickup = (status) =>
  ["picked_up", "out_for_delivery", "arrived_at_buyer", "delivered"].includes(
    String(status),
  );

const buildTrackingPayload = (orderDoc) => {
  const order =
    typeof orderDoc?.toObject === "function" ? orderDoc.toObject() : orderDoc;

  const targetLocation = isAfterPickup(order?.status)
    ? order?.buyerLocation
    : order?.sellerLocation;

  return {
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
};

module.exports = {
  isAfterPickup,
  buildTrackingPayload,
};
