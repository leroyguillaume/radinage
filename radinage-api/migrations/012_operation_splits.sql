CREATE TABLE operation_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES operations (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    amount NUMERIC(15, 4) NOT NULL,
    budget_id UUID REFERENCES budgets (id) ON DELETE SET NULL,
    UNIQUE (operation_id, position)
);

CREATE INDEX operation_splits_budget_id_idx ON operation_splits (budget_id);
