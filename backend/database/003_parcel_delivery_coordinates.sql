ALTER TABLE parcel_details
  ADD COLUMN IF NOT EXISTS parcel_pickup_latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS parcel_pickup_longitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS parcel_drop_latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS parcel_drop_longitude numeric(9,6);
