ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS verpackungsart TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS verpackungsart TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_verpackungsart_check'
  ) THEN
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_verpackungsart_check
      CHECK (verpackungsart IS NULL OR verpackungsart IN ('Karton groß', 'Karton klein'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_verpackungsart_check'
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_verpackungsart_check
      CHECK (verpackungsart IS NULL OR verpackungsart IN ('Karton groß', 'Karton klein'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS transaction_slot_assignments (
  id BIGSERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('SOURCE', 'TARGET')),
  storage_location_id INTEGER NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
  stellplatz_nr INTEGER NOT NULL CHECK (stellplatz_nr > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transaction_slot_assignments_unique
    UNIQUE (transaction_id, phase, storage_location_id, stellplatz_nr)
);

CREATE INDEX IF NOT EXISTS idx_transaction_slot_assignments_transaction
  ON transaction_slot_assignments (transaction_id, phase, stellplatz_nr);

CREATE INDEX IF NOT EXISTS idx_transaction_slot_assignments_location_slot
  ON transaction_slot_assignments (storage_location_id, stellplatz_nr, phase, transaction_id);

INSERT INTO transaction_slot_assignments (transaction_id, phase, storage_location_id, stellplatz_nr)
SELECT
  t.id,
  'SOURCE',
  t.storage_location_from_id,
  t.stellplatz_nr
FROM transactions t
WHERE t.stellplatz_nr IS NOT NULL
  AND t.storage_location_from_id IS NOT NULL
  AND t.typ IN ('OUT', 'TRANSFER')
ON CONFLICT DO NOTHING;

INSERT INTO transaction_slot_assignments (transaction_id, phase, storage_location_id, stellplatz_nr)
SELECT
  t.id,
  'TARGET',
  t.storage_location_to_id,
  t.stellplatz_nr
FROM transactions t
WHERE t.stellplatz_nr IS NOT NULL
  AND t.storage_location_to_id IS NOT NULL
  AND t.typ IN ('IN', 'TRANSFER')
ON CONFLICT DO NOTHING;

DELETE FROM inventory
WHERE menge <= 0;

DO $$
DECLARE
  inventory_row RECORD;
  free_slot RECORD;
  additional_slots_needed INTEGER;
  available_slot_count INTEGER;
BEGIN
  FOR inventory_row IN
    SELECT
      i.id,
      i.storage_location_id,
      i.article_id,
      i.stellplatz_nr,
      i.menge,
      i.verpackungsart,
      i.created_at,
      i.updated_at
    FROM inventory i
    WHERE i.menge > 1
    ORDER BY i.storage_location_id, i.stellplatz_nr, i.id
  LOOP
    additional_slots_needed := inventory_row.menge - 1;

    SELECT COUNT(*)::int
    INTO available_slot_count
    FROM storage_locations sl
    CROSS JOIN LATERAL generate_series(1, sl.kapazitaet) AS gs(slot_no)
    LEFT JOIN inventory i
      ON i.storage_location_id = sl.id
     AND i.stellplatz_nr = gs.slot_no
    WHERE sl.id = inventory_row.storage_location_id
      AND i.id IS NULL;

    IF available_slot_count < additional_slots_needed THEN
      RAISE EXCEPTION
        'Not enough free slots to expand inventory row % at storage location %',
        inventory_row.id,
        inventory_row.storage_location_id;
    END IF;

    FOR free_slot IN
      SELECT gs.slot_no::int AS stellplatz_nr
      FROM storage_locations sl
      CROSS JOIN LATERAL generate_series(1, sl.kapazitaet) AS gs(slot_no)
      LEFT JOIN inventory i
        ON i.storage_location_id = sl.id
       AND i.stellplatz_nr = gs.slot_no
      WHERE sl.id = inventory_row.storage_location_id
        AND i.id IS NULL
      ORDER BY gs.slot_no
      LIMIT additional_slots_needed
    LOOP
      INSERT INTO inventory (
        storage_location_id,
        article_id,
        menge,
        created_at,
        updated_at,
        stellplatz_nr,
        verpackungsart
      )
      VALUES (
        inventory_row.storage_location_id,
        inventory_row.article_id,
        1,
        COALESCE(inventory_row.created_at, now()),
        COALESCE(inventory_row.updated_at, now()),
        free_slot.stellplatz_nr,
        inventory_row.verpackungsart
      );
    END LOOP;

    UPDATE inventory
    SET
      menge = 1,
      updated_at = now()
    WHERE id = inventory_row.id;
  END LOOP;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM inventory
    WHERE menge <> 1
  ) THEN
    RAISE EXCEPTION 'Inventory migration failed because menge is not 1 for all rows';
  END IF;
END
$$;

ALTER TABLE inventory
  DROP CONSTRAINT IF EXISTS inventory_menge_check;

ALTER TABLE inventory
  ADD CONSTRAINT inventory_menge_check CHECK (menge = 1);

CREATE OR REPLACE FUNCTION warehouse_validate_transaction_slot_assignment()
RETURNS TRIGGER AS $$
DECLARE
  transaction_row RECORD;
  location_capacity INTEGER;
BEGIN
  SELECT
    t.typ,
    t.storage_location_from_id,
    t.storage_location_to_id
  INTO transaction_row
  FROM transactions t
  WHERE t.id = NEW.transaction_id;

  IF transaction_row IS NULL THEN
    RAISE EXCEPTION 'Transaction % not found', NEW.transaction_id;
  END IF;

  IF NEW.phase = 'SOURCE' THEN
    IF transaction_row.typ = 'IN' THEN
      RAISE EXCEPTION 'IN transactions cannot have SOURCE slot assignments';
    END IF;

    IF NEW.storage_location_id IS DISTINCT FROM transaction_row.storage_location_from_id THEN
      RAISE EXCEPTION
        'SOURCE slot assignment must use storage location % for transaction %',
        transaction_row.storage_location_from_id,
        NEW.transaction_id;
    END IF;
  ELSIF NEW.phase = 'TARGET' THEN
    IF transaction_row.typ = 'OUT' THEN
      RAISE EXCEPTION 'OUT transactions cannot have TARGET slot assignments';
    END IF;

    IF NEW.storage_location_id IS DISTINCT FROM transaction_row.storage_location_to_id THEN
      RAISE EXCEPTION
        'TARGET slot assignment must use storage location % for transaction %',
        transaction_row.storage_location_to_id,
        NEW.transaction_id;
    END IF;
  END IF;

  SELECT kapazitaet
  INTO location_capacity
  FROM storage_locations
  WHERE id = NEW.storage_location_id;

  IF location_capacity IS NULL THEN
    RAISE EXCEPTION 'Storage location % not found', NEW.storage_location_id;
  END IF;

  IF NEW.stellplatz_nr > location_capacity THEN
    RAISE EXCEPTION
      'stellplatz_nr % is outside capacity 1..% for storage location %',
      NEW.stellplatz_nr,
      location_capacity,
      NEW.storage_location_id;
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transaction_slot_assignments_validate ON transaction_slot_assignments;

CREATE TRIGGER trg_transaction_slot_assignments_validate
BEFORE INSERT OR UPDATE OF transaction_id, phase, storage_location_id, stellplatz_nr
ON transaction_slot_assignments
FOR EACH ROW
EXECUTE FUNCTION warehouse_validate_transaction_slot_assignment();
