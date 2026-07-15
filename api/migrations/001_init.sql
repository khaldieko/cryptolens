CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portfolios (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'My Portfolio',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A source is a wallet address or an imported CSV batch
CREATE TABLE IF NOT EXISTS sources (
  id          SERIAL PRIMARY KEY,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('wallet','csv')),
  label       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holdings (
  id          SERIAL PRIMARY KEY,
  source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  asset_id    TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  amount      NUMERIC(38, 18) NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric      TEXT NOT NULL CHECK (metric IN ('portfolio_volatility','asset_pct','portfolio_value')),
  condition   TEXT NOT NULL CHECK (condition IN ('above','below')),
  threshold   NUMERIC NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','email')),
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_events (
  id          SERIAL PRIMARY KEY,
  alert_id    INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  value_at_trigger NUMERIC NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cached daily closes used by the risk engine (populated in Week 3/4)
CREATE TABLE IF NOT EXISTS price_history (
  asset_id    TEXT NOT NULL,
  day         DATE NOT NULL,
  price_usd   NUMERIC NOT NULL,
  PRIMARY KEY (asset_id, day)
);

CREATE INDEX IF NOT EXISTS idx_holdings_source ON holdings(source_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
