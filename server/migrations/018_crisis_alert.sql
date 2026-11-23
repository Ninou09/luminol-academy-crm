-- Phone of the specialist warned on WhatsApp at once when a client writes in distress.
ALTER TABLE settings ADD COLUMN crisis_alert_phone TEXT NOT NULL DEFAULT '';
