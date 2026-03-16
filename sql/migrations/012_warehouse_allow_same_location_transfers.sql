ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_location_rule;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_location_rule CHECK (
    (typ = 'IN' AND storage_location_from_id IS NULL AND storage_location_to_id IS NOT NULL)
    OR (typ = 'OUT' AND storage_location_from_id IS NOT NULL AND storage_location_to_id IS NULL)
    OR (typ = 'TRANSFER' AND storage_location_from_id IS NOT NULL AND storage_location_to_id IS NOT NULL)
  );
