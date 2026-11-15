-- Manual money movements: the expenses table also records money that comes in
-- without a client charge (subsidy, sale of materials…), who was paid or paid
-- us, and how (cash, CCP, BaridiMob…). Existing rows stay "out".
ALTER TABLE expenses ADD COLUMN direction TEXT NOT NULL DEFAULT 'out' CHECK (direction IN ('in','out'));
ALTER TABLE expenses ADD COLUMN method TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN party TEXT NOT NULL DEFAULT '';
