-- Label rules that put the operations they match in a category, tried in order.
CREATE TABLE category_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    pattern_type TEXT NOT NULL CHECK (pattern_type IN ('starts_with', 'ends_with', 'contains')),
    pattern_value TEXT NOT NULL,
    UNIQUE (category_id, position)
);
