-- Account balance recorded by the user at a date, the starting point of forecasts.
-- Operations accounted on that date are considered already included in the amount.
ALTER TABLE users
ADD COLUMN balance_amount NUMERIC(15, 4),
ADD COLUMN balance_date DATE,
ADD CONSTRAINT users_balance_complete CHECK (
    (balance_amount IS NULL) = (balance_date IS NULL)
);
