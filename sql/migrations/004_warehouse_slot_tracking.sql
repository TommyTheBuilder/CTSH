ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS stellplatz_nr INTEGER;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS stellplatz_nr INTEGER;

DO $$
DECLARE
  conflict_location TEXT;
BEGIN
  SELECT sl.name
  INTO conflict_location
  FROM storage_locations sl
  JOIN inventory i ON i.storage_location_id = sl.id
  WHERE i.stellplatz_nr IS NOT NULL
    AND (i.stellplatz_nr < 1 OR i.stellplatz_nr > sl.kapazitaet)
  LIMIT 1;

  IF conflict_location IS NOT NULL THEN
    RAISE EXCEPTION 'Existing slot numbers exceed capacity for storage location %', conflict_location;
  END IF;

  SELECT sl.name
  INTO conflict_location
  FROM storage_locations sl
  JOIN inventory i ON i.storage_location_id = sl.id
  WHERE i.stellplatz_nr IS NOT NULL
  GROUP BY sl.id, sl.name, i.stellplatz_nr
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF conflict_location IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate slot occupancy exists for storage location %', conflict_location;
  END IF;

  SELECT sl.name
  INTO conflict_location
  FROM storage_locations sl
  WHERE (
    SELECT COUNT(*)
    FROM inventory i
    WHERE i.storage_location_id = sl.id
      AND i.stellplatz_nr IS NULL
  ) > (
    SELECT COUNT(*)
    FROM generate_series(1, sl.kapazitaet) AS gs(slot_no)
    LEFT JOIN inventory i
      ON i.storage_location_id = sl.id
     AND i.stellplatz_nr = gs.slot_no
    WHERE i.id IS NULL
  )
  LIMIT 1;

  IF conflict_location IS NOT NULL THEN
    RAISE EXCEPTION 'Not enough free slots to backfill inventory for storage location %', conflict_location;
  END IF;
END
$$;

WITH free_slots AS (
  SELECT
    sl.id AS storage_location_id,
    gs.slot_no::int AS stellplatz_nr,
    ROW_NUMBER() OVER (PARTITION BY sl.id ORDER BY gs.slot_no) AS rn
  FROM storage_locations sl
  CROSS JOIN LATERAL generate_series(1, sl.kapazitaet) AS gs(slot_no)
  LEFT JOIN inventory i
    ON i.storage_location_id = sl.id
   AND i.stellplatz_nr = gs.slot_no
  WHERE i.id IS NULL
),
missing_rows AS (
  SELECT
    i.id,
    i.storage_location_id,
    ROW_NUMBER() OVER (
      PARTITION BY i.storage_location_id
      ORDER BY COALESCE(i.updated_at, i.created_at), i.id
    ) AS rn
  FROM inventory i
  WHERE i.stellplatz_nr IS NULL
)
UPDATE inventory i
SET stellplatz_nr = free_slots.stellplatz_nr
FROM missing_rows
JOIN free_slots
  ON free_slots.storage_location_id = missing_rows.storage_location_id
 AND free_slots.rn = missing_rows.rn
WHERE i.id = missing_rows.id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM inventory WHERE stellplatz_nr IS NULL) THEN
    RAISE EXCEPTION 'Inventory slot backfill failed because stellplatz_nr is still NULL';
  END IF;
END
$$;

ALTER TABLE inventory
  ALTER COLUMN stellplatz_nr SET NOT NULL;

ALTER TABLE inventory
  DROP CONSTRAINT IF EXISTS inventory_unique_location_article;

ALTER TABLE inventory
  DROP CONSTRAINT IF EXISTS inventory_unique_location_slot;

ALTER TABLE inventory
  ADD CONSTRAINT inventory_unique_location_slot UNIQUE (storage_location_id, stellplatz_nr);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_stellplatz_nr_check'
  ) THEN
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_stellplatz_nr_check CHECK (stellplatz_nr > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_stellplatz_nr_check'
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_stellplatz_nr_check CHECK (stellplatz_nr IS NULL OR stellplatz_nr > 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_inventory_location_slot
  ON inventory (storage_location_id, stellplatz_nr);

CREATE INDEX IF NOT EXISTS idx_inventory_slot_article
  ON inventory (stellplatz_nr, article_id);

CREATE INDEX IF NOT EXISTS idx_transactions_slot
  ON transactions (stellplatz_nr);

CREATE INDEX IF NOT EXISTS idx_transactions_to_location_slot
  ON transactions (storage_location_to_id, stellplatz_nr, datum DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_from_location_slot
  ON transactions (storage_location_from_id, stellplatz_nr, datum DESC);

CREATE OR REPLACE FUNCTION warehouse_validate_inventory_slot()
RETURNS TRIGGER AS $$
DECLARE
  location_capacity INTEGER;
BEGIN
  SELECT kapazitaet
  INTO location_capacity
  FROM storage_locations
  WHERE id = NEW.storage_location_id;

  IF location_capacity IS NULL THEN
    RAISE EXCEPTION 'Storage location % not found', NEW.storage_location_id;
  END IF;

  IF NEW.stellplatz_nr < 1 OR NEW.stellplatz_nr > location_capacity THEN
    RAISE EXCEPTION 'stellplatz_nr % is outside capacity 1..% for storage location %',
      NEW.stellplatz_nr,
      location_capacity,
      NEW.storage_location_id;
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_validate_slot ON inventory;

CREATE TRIGGER trg_inventory_validate_slot
BEFORE INSERT OR UPDATE OF storage_location_id, stellplatz_nr
ON inventory
FOR EACH ROW
EXECUTE FUNCTION warehouse_validate_inventory_slot();

CREATE OR REPLACE FUNCTION warehouse_validate_transaction_slot()
RETURNS TRIGGER AS $$
DECLARE
  source_capacity INTEGER;
  target_capacity INTEGER;
BEGIN
  IF NEW.stellplatz_nr IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.stellplatz_nr < 1 THEN
    RAISE EXCEPTION 'stellplatz_nr must be >= 1';
  END IF;

  IF NEW.typ = 'IN' THEN
    SELECT kapazitaet INTO target_capacity FROM storage_locations WHERE id = NEW.storage_location_to_id;
    IF target_capacity IS NULL THEN
      RAISE EXCEPTION 'Storage location % not found', NEW.storage_location_to_id;
    END IF;
    IF NEW.stellplatz_nr > target_capacity THEN
      RAISE EXCEPTION 'stellplatz_nr % is outside capacity 1..% for storage location %',
        NEW.stellplatz_nr,
        target_capacity,
        NEW.storage_location_to_id;
    END IF;
  ELSIF NEW.typ = 'OUT' THEN
    SELECT kapazitaet INTO source_capacity FROM storage_locations WHERE id = NEW.storage_location_from_id;
    IF source_capacity IS NULL THEN
      RAISE EXCEPTION 'Storage location % not found', NEW.storage_location_from_id;
    END IF;
    IF NEW.stellplatz_nr > source_capacity THEN
      RAISE EXCEPTION 'stellplatz_nr % is outside capacity 1..% for storage location %',
        NEW.stellplatz_nr,
        source_capacity,
        NEW.storage_location_from_id;
    END IF;
  ELSIF NEW.typ = 'TRANSFER' THEN
    SELECT kapazitaet INTO source_capacity FROM storage_locations WHERE id = NEW.storage_location_from_id;
    SELECT kapazitaet INTO target_capacity FROM storage_locations WHERE id = NEW.storage_location_to_id;

    IF source_capacity IS NULL THEN
      RAISE EXCEPTION 'Storage location % not found', NEW.storage_location_from_id;
    END IF;
    IF target_capacity IS NULL THEN
      RAISE EXCEPTION 'Storage location % not found', NEW.storage_location_to_id;
    END IF;
    IF NEW.stellplatz_nr > source_capacity OR NEW.stellplatz_nr > target_capacity THEN
      RAISE EXCEPTION 'stellplatz_nr % is outside the source or destination capacity',
        NEW.stellplatz_nr;
    END IF;
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_validate_slot ON transactions;

CREATE TRIGGER trg_transactions_validate_slot
BEFORE INSERT OR UPDATE OF typ, storage_location_from_id, storage_location_to_id, stellplatz_nr
ON transactions
FOR EACH ROW
EXECUTE FUNCTION warehouse_validate_transaction_slot();

CREATE OR REPLACE FUNCTION warehouse_validate_storage_location_capacity()
RETURNS TRIGGER AS $$
DECLARE
  max_slot INTEGER;
BEGIN
  SELECT COALESCE(MAX(stellplatz_nr), 0)::int
  INTO max_slot
  FROM inventory
  WHERE storage_location_id = NEW.id;

  IF NEW.kapazitaet < max_slot THEN
    RAISE EXCEPTION 'kapazitaet cannot be reduced below occupied slot %', max_slot;
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_storage_locations_validate_capacity ON storage_locations;

CREATE TRIGGER trg_storage_locations_validate_capacity
BEFORE UPDATE OF kapazitaet
ON storage_locations
FOR EACH ROW
EXECUTE FUNCTION warehouse_validate_storage_location_capacity();
