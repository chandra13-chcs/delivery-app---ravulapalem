ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS business_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'categories'::regclass
      AND conname = 'categories_business_type_check'
  ) THEN
    ALTER TABLE categories
      ADD CONSTRAINT categories_business_type_check
      CHECK (business_type IS NULL OR business_type IN ('RESTAURANT', 'GROCERY', 'MEAT', 'OTHER'));
  END IF;
END;
$$;
