-- Column a profile reads the label from when the label column is blank, if any.
ALTER TABLE import_profiles
ADD COLUMN label_fallback_col INTEGER CHECK (label_fallback_col >= 0);
