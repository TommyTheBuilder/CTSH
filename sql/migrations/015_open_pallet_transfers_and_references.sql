ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS reference_no TEXT;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS destination_reference_no TEXT;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS destination_customer_id INTEGER REFERENCES open_pallet_customers(id) ON DELETE SET NULL;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS destination_company TEXT;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS destination_street TEXT;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS destination_address_extra TEXT;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS destination_postal_code TEXT;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS destination_city TEXT;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS destination_country TEXT;

CREATE INDEX IF NOT EXISTS idx_open_pallet_bookings_destination_customer_lookup
  ON open_pallet_bookings (app_customer_id, destination_customer_id);
