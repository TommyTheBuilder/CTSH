ALTER TABLE transactions
  ALTER COLUMN beleg_nr DROP NOT NULL;

ALTER TABLE picking_orders
  ALTER COLUMN beleg_nr DROP NOT NULL;

ALTER TABLE picking_order_items
  ADD COLUMN IF NOT EXISTS positions_nr TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'articles'
  ) THEN
    UPDATE picking_order_items poi
    SET positions_nr = COALESCE(
      NULLIF(BTRIM(poi.positions_nr), ''),
      NULLIF(BTRIM(a.artikel_nr), ''),
      NULLIF(BTRIM(a.bezeichnung), ''),
      'Position ' || poi.id
    )
    FROM articles a
    WHERE poi.article_id = a.id
      AND (poi.positions_nr IS NULL OR BTRIM(poi.positions_nr) = '');
  END IF;
END
$$;

UPDATE picking_order_items
SET positions_nr = COALESCE(NULLIF(BTRIM(positions_nr), ''), 'Position ' || id)
WHERE positions_nr IS NULL OR BTRIM(positions_nr) = '';

ALTER TABLE picking_order_items
  ALTER COLUMN positions_nr SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_positions_nr
  ON transactions (LOWER(COALESCE(positions_nr, '')));

CREATE INDEX IF NOT EXISTS idx_picking_order_items_positions_nr
  ON picking_order_items (LOWER(positions_nr));

ALTER TABLE inventory
  DROP COLUMN IF EXISTS article_id CASCADE;

ALTER TABLE transactions
  DROP COLUMN IF EXISTS article_id CASCADE;

ALTER TABLE picking_order_items
  DROP COLUMN IF EXISTS article_id CASCADE;

DROP TABLE IF EXISTS articles CASCADE;

UPDATE roles
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'::jsonb),
  '{warehouse}',
  COALESCE(permissions->'warehouse', '{}'::jsonb) - 'articles',
  true
)
WHERE permissions ? 'warehouse';
