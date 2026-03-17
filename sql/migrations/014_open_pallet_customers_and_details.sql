CREATE TABLE IF NOT EXISTS open_pallet_customers (
  id SERIAL PRIMARY KEY,
  app_customer_id INTEGER NOT NULL REFERENCES app_customers(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  street TEXT,
  address_extra TEXT,
  postal_code TEXT,
  city TEXT,
  country TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_open_pallet_customers_name_unique
  ON open_pallet_customers (app_customer_id, LOWER(name));

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES open_pallet_customers(id) ON DELETE SET NULL;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS street TEXT;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS address_extra TEXT;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS country TEXT;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS truck_planned_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS truck_planned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_open_pallet_customers_customer_sort
  ON open_pallet_customers (app_customer_id, name);

CREATE INDEX IF NOT EXISTS idx_open_pallet_bookings_customer_lookup
  ON open_pallet_bookings (app_customer_id, customer_id);
