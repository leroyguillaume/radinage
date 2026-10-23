-- Category colours are any #rrggbb: palette keys become their value.
UPDATE categories
SET
    color = CASE color
        WHEN 'forest' THEN '#327f56'
        WHEN 'blue' THEN '#228be6'
        WHEN 'cyan' THEN '#15aabf'
        WHEN 'teal' THEN '#12b886'
        WHEN 'lime' THEN '#82c91e'
        WHEN 'yellow' THEN '#fab005'
        WHEN 'orange' THEN '#fd7e14'
        WHEN 'red' THEN '#fa5252'
        WHEN 'pink' THEN '#e64980'
        WHEN 'grape' THEN '#be4bdb'
        WHEN 'violet' THEN '#7950f2'
        WHEN 'indigo' THEN '#4c6ef5'
        WHEN 'gray' THEN '#868e96'
    END
WHERE color NOT LIKE '#%';
