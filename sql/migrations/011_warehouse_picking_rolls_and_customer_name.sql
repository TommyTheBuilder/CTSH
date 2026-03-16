ALTER TABLE customers
  ALTER COLUMN kunden_nr DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'picking_orders'
      AND column_name = 'beleg_nr'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'picking_orders'
      AND column_name = 'notiz'
  ) THEN
    ALTER TABLE picking_orders RENAME COLUMN beleg_nr TO notiz;
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'picking_orders'
      AND column_name = 'beleg_nr'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'picking_orders'
      AND column_name = 'notiz'
  ) THEN
    UPDATE picking_orders
    SET notiz = COALESCE(NULLIF(BTRIM(notiz), ''), beleg_nr)
    WHERE COALESCE(BTRIM(notiz), '') = ''
      AND beleg_nr IS NOT NULL;

    ALTER TABLE picking_orders DROP COLUMN beleg_nr;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'picking_orders'
      AND column_name = 'notiz'
  ) THEN
    ALTER TABLE picking_orders ADD COLUMN notiz TEXT;
  END IF;
END
$$;

ALTER TABLE picking_order_items
  ADD COLUMN IF NOT EXISTS rollen_nummern TEXT;

UPDATE picking_order_items
SET rollen_nummern = COALESCE(
  NULLIF(BTRIM(rollen_nummern), ''),
  CASE
    WHEN menge_soll IS NOT NULL AND menge_ist IS NOT NULL AND menge_ist <> 0 AND menge_ist <> menge_soll
      THEN 'Alt Soll/Ist: ' || menge_soll::text || '/' || menge_ist::text
    WHEN menge_soll IS NOT NULL THEN menge_soll::text
    WHEN menge_ist IS NOT NULL AND menge_ist > 0 THEN menge_ist::text
    ELSE '1'
  END
)
WHERE rollen_nummern IS NULL OR BTRIM(rollen_nummern) = '';

ALTER TABLE picking_order_items
  ALTER COLUMN rollen_nummern SET NOT NULL;

ALTER TABLE picking_order_items
  DROP COLUMN IF EXISTS menge_soll;

ALTER TABLE picking_order_items
  DROP COLUMN IF EXISTS menge_ist;

DROP INDEX IF EXISTS idx_picking_orders_beleg_nr;

CREATE INDEX IF NOT EXISTS idx_picking_orders_notiz
  ON picking_orders (LOWER(COALESCE(notiz, '')));

CREATE INDEX IF NOT EXISTS idx_picking_order_items_rollen_nummern
  ON picking_order_items (LOWER(COALESCE(rollen_nummern, '')));
