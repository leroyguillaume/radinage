-- Categories a user sorts operations into, independently of budgets.
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT categories_user_name_key UNIQUE (user_id, name)
);

-- A budget's category is the default of the operations and split parts linked to it.
ALTER TABLE budgets
ADD COLUMN category_id UUID REFERENCES categories (id) ON DELETE SET NULL;

ALTER TABLE operations
ADD COLUMN category_id UUID REFERENCES categories (id) ON DELETE SET NULL;

ALTER TABLE operation_splits
ADD COLUMN category_id UUID REFERENCES categories (id) ON DELETE SET NULL;

CREATE INDEX operations_category_id_idx ON operations (category_id);

CREATE INDEX operation_splits_category_id_idx ON operation_splits (category_id);
