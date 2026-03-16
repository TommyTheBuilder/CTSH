CREATE TABLE IF NOT EXISTS pallet_admin_history (
  id SERIAL PRIMARY KEY,
  app_customer_id INTEGER NOT NULL REFERENCES app_customers(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_label TEXT NOT NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pallet_admin_history_customer_created
  ON pallet_admin_history (app_customer_id, created_at DESC);
