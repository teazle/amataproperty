-- Add structured listing detail columns
ALTER TABLE listings
ADD COLUMN IF NOT EXISTS beds INTEGER,
ADD COLUMN IF NOT EXISTS baths INTEGER,
ADD COLUMN IF NOT EXISTS size_sqft DECIMAL,
ADD COLUMN IF NOT EXISTS price_psf DECIMAL,
ADD COLUMN IF NOT EXISTS year_built INTEGER,
ADD COLUMN IF NOT EXISTS tenure TEXT;

-- Remove old unstructured columns that we're no longer using
ALTER TABLE listings
DROP COLUMN IF EXISTS amenities_and_nearby,
DROP COLUMN IF EXISTS project_details,
DROP COLUMN IF EXISTS details,
DROP COLUMN IF EXISTS description;

-- Keep address column as it's still useful

