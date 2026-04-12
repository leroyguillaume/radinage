CREATE TABLE budgets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label        TEXT NOT NULL,
    budget_type  TEXT NOT NULL CHECK (budget_type IN ('expense', 'income', 'savings')),
    -- kind discriminant
    kind_type    TEXT NOT NULL CHECK (kind_type IN ('recurring', 'occasional')),
    -- occasional fields (NULL for recurring)
    kind_month   SMALLINT,
    kind_year    INTEGER,
    kind_amount  NUMERIC(15, 4),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX budgets_user_id_idx ON budgets(user_id);

CREATE TABLE budget_periods (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id  UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date   DATE NOT NULL,
    amount     NUMERIC(15, 4) NOT NULL
);

CREATE INDEX budget_periods_budget_id_idx ON budget_periods(budget_id);

CREATE TABLE budget_rules (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id     UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,
    pattern_type  TEXT NOT NULL CHECK (pattern_type IN ('starts_with', 'ends_with', 'contains')),
    pattern_value TEXT NOT NULL,
    match_amount  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX budget_rules_budget_id_idx ON budget_rules(budget_id);
