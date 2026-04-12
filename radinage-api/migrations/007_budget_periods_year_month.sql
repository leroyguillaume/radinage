-- Replace DATE columns with year/month integers for month-level precision.

ALTER TABLE budget_periods
    ADD COLUMN start_year  INTEGER,
    ADD COLUMN start_month INTEGER,
    ADD COLUMN end_year    INTEGER,
    ADD COLUMN end_month   INTEGER;

UPDATE budget_periods
SET start_year  = EXTRACT(YEAR  FROM start_date)::INTEGER,
    start_month = EXTRACT(MONTH FROM start_date)::INTEGER,
    end_year    = EXTRACT(YEAR  FROM end_date)::INTEGER,
    end_month   = EXTRACT(MONTH FROM end_date)::INTEGER;

ALTER TABLE budget_periods
    ALTER COLUMN start_year  SET NOT NULL,
    ALTER COLUMN start_month SET NOT NULL;

ALTER TABLE budget_periods
    DROP COLUMN start_date,
    DROP COLUMN end_date;
