# Product Metadata Migration Runbook

This runbook covers the safe rollout of barcode and expiry metadata backfill.

## Scope

The migration script:
- trims and normalizes `barcode`
- normalizes invalid `expiryDate` values to `null`
- resolves duplicate barcodes within the same tenant by clearing extra duplicates

Script entrypoints:
- `npm run migrate:product-metadata:dry-run`
- `npm run migrate:product-metadata`
- `npm run smoke:migration`

## Preconditions

1. Confirm application version includes:
- product barcode and expiry fields
- per-tenant barcode uniqueness validation in API
- integration tests passing

2. Confirm environment variables:
- `MONGO_URI` points to target environment

Optional API smoke-check environment variables:
- `SMOKE_API_BASE_URL` (example: `https://your-backend.example.com/api`)
- `SMOKE_SELLER_IDENTIFIER`
- `SMOKE_SELLER_PASSWORD`
- `SMOKE_DEVICE_ID` (optional)

3. Confirm backup policy:
- snapshot/backup completed for target database

## Staging Procedure

1. Deploy backend build to staging.
2. Run dry-run:
- `npm run migrate:product-metadata:dry-run`
3. Record output counts:
- visited products
- products to sanitize
- duplicate barcode groups
- duplicate barcode entries to clear
4. Run live migration:
- `npm run migrate:product-metadata`
5. Verify post-migration API behavior:
- create product with duplicate barcode in same seller should return `409`
- create product with same barcode in different seller should return `201`
- pharmacy tenant product create without expiry date should return `400`
6. Run smoke script:
- `npm run smoke:migration`

## Production Procedure

1. Announce maintenance window for write-sensitive catalog operations.
2. Confirm latest database backup is complete.
3. Run dry-run and save output logs.
4. Review counts. If unexpected, stop and investigate.
5. Run live migration.
6. Execute smoke verification through API/UI:
- seller product create/edit
- POS product search by barcode
- pharmacy expiry validation
7. Run scripted smoke checks:
- `npm run smoke:migration`
8. If API credentials are configured, confirm API checks in smoke output are PASS.
9. Close maintenance window.

## Rollback Guidance

If migration results are unexpected:

1. Stop write traffic to product endpoints.
2. Restore from latest backup/snapshot.
3. Redeploy previous stable backend if needed.
4. Re-run dry-run in staging with production-like snapshot to diagnose.

## Verification Queries (Mongo shell)

Check duplicate barcodes per seller:

```javascript
 db.products.aggregate([
   { $match: { barcode: { $exists: true, $ne: "" } } },
   {
     $group: {
       _id: { sellerId: "$sellerId", barcode: "$barcode" },
       count: { $sum: 1 }
     }
   },
   { $match: { count: { $gt: 1 } } }
 ])
```

Check invalid expiry date values (should be none):

```javascript
 db.products.find({ expiryDate: { $type: "string" } }).limit(20)
```

## Notes

- Dry-run mode performs reads and analysis only; it does not write.
- The script is idempotent and safe to re-run.
- Smoke script always runs DB checks; API checks run only when `SMOKE_*` credentials are provided.
