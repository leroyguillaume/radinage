-- Field separator a profile reads CSV files with; spreadsheets ignore it.
ALTER TABLE import_profiles
ADD COLUMN csv_delimiter TEXT NOT NULL DEFAULT 'comma'
CHECK (csv_delimiter IN ('comma', 'semicolon', 'tab', 'pipe'));
