CREATE TABLE login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  window_start INTEGER NOT NULL
);
