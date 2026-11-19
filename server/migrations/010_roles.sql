-- Four sign-ins: Directeur (admin), Administrateur (manager),
-- Secrétaire (admissions), Enseignant / Spécialiste (instructor).
-- Accounting goes with the director; academic coordinators become administrators.
UPDATE users SET role='admin' WHERE role='finance';
UPDATE users SET role='manager' WHERE role='academic';
