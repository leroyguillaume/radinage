-- Add recurrence column to budgets table for recurring budgets.
-- Defaults to 'monthly' for existing recurring budgets.
ALTER TABLE budgets
    ADD COLUMN recurrence TEXT;

UPDATE budgets SET recurrence = 'monthly' WHERE kind_type = 'recurring';

ALTER TABLE budgets
    ADD CONSTRAINT budgets_recurrence_check
        CHECK (recurrence IN ('weekly', 'monthly', 'quarterly', 'yearly')
               OR kind_type != 'recurring');
