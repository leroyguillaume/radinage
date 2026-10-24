-- A part left without its own date is attributed to its operation's month.
ALTER TABLE operation_splits ADD COLUMN effective_date DATE;
