-- Week 5: track last-fired time so the evaluator doesn't re-notify every cycle
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS last_fired_at TIMESTAMPTZ;
-- Mark whether a triggered event has been seen in-app
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS seen BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS message TEXT;
CREATE INDEX IF NOT EXISTS idx_alert_events_alert ON alert_events(alert_id);
