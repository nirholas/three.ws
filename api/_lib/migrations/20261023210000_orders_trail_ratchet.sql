-- Two-phase ratcheting trailing stop (order type 'trail_ratchet').
-- ratchet holds { initial_stop_pct, tiers: [{ profit_pct, lock_pct }] }. The entry
-- price is orders.reference_price and the high-water mark is orders.peak_price.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ratchet JSONB;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_type_check
    CHECK (type IN ('limit','stop','trailing','trail_ratchet','dca','twap','conditional'));
