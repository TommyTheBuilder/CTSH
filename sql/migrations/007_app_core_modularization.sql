CREATE TABLE IF NOT EXISTS app_customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_customers (name, slug)
VALUES ('Standardkunde', 'standardkunde')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS app_customer_id INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_app_admin BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE roles ADD COLUMN IF NOT EXISTS app_customer_id INTEGER;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS app_customer_id INTEGER;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS app_customer_id INTEGER;
ALTER TABLE entrepreneurs ADD COLUMN IF NOT EXISTS app_customer_id INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS app_customer_id INTEGER;
ALTER TABLE entrepreneur_history ADD COLUMN IF NOT EXISTS app_customer_id INTEGER;
ALTER TABLE booking_cases ADD COLUMN IF NOT EXISTS app_customer_id INTEGER;
ALTER TABLE booking_case_history ADD COLUMN IF NOT EXISTS app_customer_id INTEGER;

UPDATE users
SET app_customer_id = c.id
FROM app_customers c
WHERE users.app_customer_id IS NULL
  AND c.slug = 'standardkunde';

UPDATE roles
SET app_customer_id = c.id
FROM app_customers c
WHERE roles.app_customer_id IS NULL
  AND c.slug = 'standardkunde';

UPDATE locations
SET app_customer_id = c.id
FROM app_customers c
WHERE locations.app_customer_id IS NULL
  AND c.slug = 'standardkunde';

UPDATE departments
SET app_customer_id = c.id
FROM app_customers c
WHERE departments.app_customer_id IS NULL
  AND c.slug = 'standardkunde';

UPDATE entrepreneurs
SET app_customer_id = c.id
FROM app_customers c
WHERE entrepreneurs.app_customer_id IS NULL
  AND c.slug = 'standardkunde';

UPDATE bookings b
SET app_customer_id = COALESCE(u.app_customer_id, l.app_customer_id)
FROM users u
LEFT JOIN locations l ON l.id = b.location_id
WHERE b.app_customer_id IS NULL
  AND u.id = b.user_id;

UPDATE bookings b
SET app_customer_id = l.app_customer_id
FROM locations l
WHERE b.app_customer_id IS NULL
  AND l.id = b.location_id;

UPDATE entrepreneur_history eh
SET app_customer_id = COALESCE(u.app_customer_id, l.app_customer_id)
FROM users u
LEFT JOIN locations l ON l.id = eh.location_id
WHERE eh.app_customer_id IS NULL
  AND u.id = eh.created_by;

UPDATE entrepreneur_history eh
SET app_customer_id = l.app_customer_id
FROM locations l
WHERE eh.app_customer_id IS NULL
  AND l.id = eh.location_id;

UPDATE booking_cases bc
SET app_customer_id = COALESCE(u.app_customer_id, l.app_customer_id)
FROM users u
LEFT JOIN locations l ON l.id = bc.location_id
WHERE bc.app_customer_id IS NULL
  AND u.id = bc.created_by;

UPDATE booking_cases bc
SET app_customer_id = l.app_customer_id
FROM locations l
WHERE bc.app_customer_id IS NULL
  AND l.id = bc.location_id;

UPDATE booking_case_history bch
SET app_customer_id = COALESCE(bc.app_customer_id, u.app_customer_id)
FROM booking_cases bc
LEFT JOIN users u ON u.id = bch.changed_by
WHERE bch.app_customer_id IS NULL
  AND bc.id = bch.case_id;

UPDATE users
SET is_app_admin = TRUE
WHERE role = 'admin';

ALTER TABLE users
  ALTER COLUMN app_customer_id SET NOT NULL;

ALTER TABLE roles
  ALTER COLUMN app_customer_id SET NOT NULL;

ALTER TABLE locations
  ALTER COLUMN app_customer_id SET NOT NULL;

ALTER TABLE departments
  ALTER COLUMN app_customer_id SET NOT NULL;

ALTER TABLE entrepreneurs
  ALTER COLUMN app_customer_id SET NOT NULL;

ALTER TABLE bookings
  ALTER COLUMN app_customer_id SET NOT NULL;

ALTER TABLE entrepreneur_history
  ALTER COLUMN app_customer_id SET NOT NULL;

ALTER TABLE booking_cases
  ALTER COLUMN app_customer_id SET NOT NULL;

ALTER TABLE booking_case_history
  ALTER COLUMN app_customer_id SET NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_app_customer_id_fkey;
ALTER TABLE users
  ADD CONSTRAINT users_app_customer_id_fkey
  FOREIGN KEY (app_customer_id) REFERENCES app_customers(id) ON DELETE RESTRICT;

ALTER TABLE roles
  DROP CONSTRAINT IF EXISTS roles_app_customer_id_fkey;
ALTER TABLE roles
  ADD CONSTRAINT roles_app_customer_id_fkey
  FOREIGN KEY (app_customer_id) REFERENCES app_customers(id) ON DELETE CASCADE;

ALTER TABLE locations
  DROP CONSTRAINT IF EXISTS locations_app_customer_id_fkey;
ALTER TABLE locations
  ADD CONSTRAINT locations_app_customer_id_fkey
  FOREIGN KEY (app_customer_id) REFERENCES app_customers(id) ON DELETE CASCADE;

ALTER TABLE departments
  DROP CONSTRAINT IF EXISTS departments_app_customer_id_fkey;
ALTER TABLE departments
  ADD CONSTRAINT departments_app_customer_id_fkey
  FOREIGN KEY (app_customer_id) REFERENCES app_customers(id) ON DELETE CASCADE;

ALTER TABLE entrepreneurs
  DROP CONSTRAINT IF EXISTS entrepreneurs_app_customer_id_fkey;
ALTER TABLE entrepreneurs
  ADD CONSTRAINT entrepreneurs_app_customer_id_fkey
  FOREIGN KEY (app_customer_id) REFERENCES app_customers(id) ON DELETE CASCADE;

ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_app_customer_id_fkey;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_app_customer_id_fkey
  FOREIGN KEY (app_customer_id) REFERENCES app_customers(id) ON DELETE RESTRICT;

ALTER TABLE entrepreneur_history
  DROP CONSTRAINT IF EXISTS entrepreneur_history_app_customer_id_fkey;
ALTER TABLE entrepreneur_history
  ADD CONSTRAINT entrepreneur_history_app_customer_id_fkey
  FOREIGN KEY (app_customer_id) REFERENCES app_customers(id) ON DELETE RESTRICT;

ALTER TABLE booking_cases
  DROP CONSTRAINT IF EXISTS booking_cases_app_customer_id_fkey;
ALTER TABLE booking_cases
  ADD CONSTRAINT booking_cases_app_customer_id_fkey
  FOREIGN KEY (app_customer_id) REFERENCES app_customers(id) ON DELETE RESTRICT;

ALTER TABLE booking_case_history
  DROP CONSTRAINT IF EXISTS booking_case_history_app_customer_id_fkey;
ALTER TABLE booking_case_history
  ADD CONSTRAINT booking_case_history_app_customer_id_fkey
  FOREIGN KEY (app_customer_id) REFERENCES app_customers(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS roles_customer_name_unique
  ON roles (app_customer_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS locations_customer_name_unique
  ON locations (app_customer_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS departments_customer_name_unique
  ON departments (app_customer_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS entrepreneurs_customer_name_unique
  ON entrepreneurs (app_customer_id, name);

CREATE TABLE IF NOT EXISTS app_modules (
  module_key TEXT PRIMARY KEY,
  module_name TEXT NOT NULL,
  module_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_modules (module_key, module_name, module_description)
VALUES
  ('pallets', 'Paletten', 'Paletten-Buchungen, Bestände, Vorgänge und moduleigene Stammdaten.'),
  ('warehouse', 'Lager-Versandsystem', 'Lager- und Versandprozesse als separates Modul.'),
  ('container_registration', 'Container Anmeldung', 'Check-in, Statusboard und Adminfunktionen für Container.'),
  ('container_planning', 'Container und LKW Planung', 'Planungsmodul für Slots und Transporte.')
ON CONFLICT (module_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS app_customer_modules (
  app_customer_id INTEGER NOT NULL REFERENCES app_customers(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL REFERENCES app_modules(module_key) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app_customer_id, module_key)
);

INSERT INTO app_customer_modules (app_customer_id, module_key, is_enabled)
SELECT c.id, m.module_key, TRUE
FROM app_customers c
CROSS JOIN app_modules m
ON CONFLICT (app_customer_id, module_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_users_app_customer_id ON users (app_customer_id);
CREATE INDEX IF NOT EXISTS idx_roles_app_customer_id ON roles (app_customer_id);
CREATE INDEX IF NOT EXISTS idx_locations_app_customer_id ON locations (app_customer_id);
CREATE INDEX IF NOT EXISTS idx_departments_app_customer_id ON departments (app_customer_id);
CREATE INDEX IF NOT EXISTS idx_entrepreneurs_app_customer_id ON entrepreneurs (app_customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_app_customer_id ON bookings (app_customer_id);
CREATE INDEX IF NOT EXISTS idx_booking_cases_app_customer_id ON booking_cases (app_customer_id);
