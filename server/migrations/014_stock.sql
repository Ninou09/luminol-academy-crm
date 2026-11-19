-- Stock of books, tests and materials sold or handed out at the academy.
CREATE TABLE stock_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  updated_at TEXT NOT NULL
);
