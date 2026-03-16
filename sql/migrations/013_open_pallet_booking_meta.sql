ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS urgency_level TEXT NOT NULL DEFAULT 'medium' CHECK (
    urgency_level IN ('low', 'medium', 'high', 'critical')
  );

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS truck_license_plate TEXT;

ALTER TABLE open_pallet_bookings
  ADD COLUMN IF NOT EXISTS truck_planned_for DATE;

DROP INDEX IF EXISTS idx_open_pallet_bookings_customer_updated;

CREATE INDEX IF NOT EXISTS idx_open_pallet_bookings_customer_status
  ON open_pallet_bookings (
    app_customer_id,
    (CASE status
      WHEN 'open' THEN 1
      WHEN 'truck_planned' THEN 2
      WHEN 'completed_waiting_document' THEN 3
      WHEN 'document_booked_scanned' THEN 4
      ELSE 0
    END) DESC,
    created_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_open_pallet_bookings_department_status_sort
  ON open_pallet_bookings (department_id, status, created_at DESC);
