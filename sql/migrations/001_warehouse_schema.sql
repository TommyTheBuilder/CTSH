DO $$
BEGIN
  CREATE TYPE warehouse_storage_location_type AS ENUM ('Regal', 'Bodenstellplatz');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE warehouse_transaction_type AS ENUM ('IN', 'OUT', 'TRANSFER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE warehouse_picking_status AS ENUM ('OFFEN', 'IN_BEARBEITUNG', 'ERLEDIGT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  kunden_nr TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  adresse TEXT,
  kontakt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  artikel_nr TEXT NOT NULL UNIQUE,
  bezeichnung TEXT NOT NULL,
  beschreibung TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage_locations (
  id SERIAL PRIMARY KEY,
  typ warehouse_storage_location_type NOT NULL,
  name TEXT NOT NULL UNIQUE,
  kapazitaet INTEGER NOT NULL CHECK (kapazitaet > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  storage_location_id INTEGER NOT NULL REFERENCES storage_locations(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  menge INTEGER NOT NULL CHECK (menge >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_unique_location_article UNIQUE (storage_location_id, article_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  typ warehouse_transaction_type NOT NULL,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  menge INTEGER NOT NULL CHECK (menge > 0),
  storage_location_from_id INTEGER REFERENCES storage_locations(id) ON DELETE RESTRICT,
  storage_location_to_id INTEGER REFERENCES storage_locations(id) ON DELETE RESTRICT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  beleg_nr TEXT,
  positions_nr TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  datum TIMESTAMPTZ NOT NULL DEFAULT now(),
  notiz TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transactions_location_rule CHECK (
    (typ = 'IN' AND storage_location_from_id IS NULL AND storage_location_to_id IS NOT NULL)
    OR (typ = 'OUT' AND storage_location_from_id IS NOT NULL AND storage_location_to_id IS NULL)
    OR (typ = 'TRANSFER' AND storage_location_from_id IS NOT NULL AND storage_location_to_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS picking_orders (
  id BIGSERIAL PRIMARY KEY,
  status warehouse_picking_status NOT NULL DEFAULT 'OFFEN',
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  beleg_nr TEXT NOT NULL,
  ersteller_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  bearbeiter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  faellig_am DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS picking_order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES picking_orders(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  menge_soll INTEGER NOT NULL CHECK (menge_soll > 0),
  menge_ist INTEGER NOT NULL DEFAULT 0 CHECK (menge_ist >= 0)
);

CREATE INDEX IF NOT EXISTS idx_customers_kunden_nr ON customers (LOWER(kunden_nr));
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_articles_artikel_nr ON articles (LOWER(artikel_nr));
CREATE INDEX IF NOT EXISTS idx_articles_bezeichnung ON articles (LOWER(bezeichnung));
CREATE INDEX IF NOT EXISTS idx_storage_locations_name ON storage_locations (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_inventory_location ON inventory (storage_location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_article ON inventory (article_id);
CREATE INDEX IF NOT EXISTS idx_transactions_article_datum ON transactions (article_id, datum DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions (customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_datum ON transactions (datum DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_beleg_nr ON transactions (LOWER(beleg_nr));
CREATE INDEX IF NOT EXISTS idx_transactions_from_location ON transactions (storage_location_from_id);
CREATE INDEX IF NOT EXISTS idx_transactions_to_location ON transactions (storage_location_to_id);
CREATE INDEX IF NOT EXISTS idx_picking_orders_status_due ON picking_orders (status, faellig_am, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_picking_orders_customer ON picking_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_picking_orders_beleg_nr ON picking_orders (LOWER(beleg_nr));
CREATE INDEX IF NOT EXISTS idx_picking_order_items_order ON picking_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_picking_order_items_article ON picking_order_items (article_id);
