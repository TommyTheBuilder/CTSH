CREATE TABLE IF NOT EXISTS open_pallet_bookings (
  id SERIAL PRIMARY KEY,
  app_customer_id INTEGER NOT NULL REFERENCES app_customers(id) ON DELETE RESTRICT,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  company TEXT,
  city TEXT,
  postal_code TEXT,
  order_no TEXT,
  pallet_count INTEGER NOT NULL CHECK (pallet_count > 0),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN (
      'open',
      'truck_planned',
      'completed_waiting_document',
      'document_booked_scanned'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_open_pallet_bookings_customer_updated
  ON open_pallet_bookings (app_customer_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_open_pallet_bookings_department_status
  ON open_pallet_bookings (department_id, status, updated_at DESC);
