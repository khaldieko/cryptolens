-- Week 3: allow clean upserts of holdings per (source, asset)
CREATE UNIQUE INDEX IF NOT EXISTS uq_holdings_source_asset
  ON holdings (source_id, asset_id);
