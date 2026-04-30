const withSellerScope = (sellerId, query = {}) => {
  if (!sellerId) {
    throw new Error("sellerId is required for tenant-scoped query");
  }

  return {
    ...query,
    sellerId,
  };
};

module.exports = {
  withSellerScope,
};
