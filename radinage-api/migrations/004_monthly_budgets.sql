CREATE TABLE monthly_budgets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    range_start_year INTEGER NOT NULL,
    range_start_month SMALLINT NOT NULL,
    range_end_year   INTEGER NOT NULL,
    range_end_month  SMALLINT NOT NULL,
    amount           NUMERIC(15, 4) NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX monthly_budgets_user_id_idx ON monthly_budgets(user_id);
