-- Add extra columns to listings table for additional details
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS amenities_and_nearby TEXT,
ADD COLUMN IF NOT EXISTS project_details TEXT,
ADD COLUMN IF NOT EXISTS details TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS address TEXT;
