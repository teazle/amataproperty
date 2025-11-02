# Production Setup Guide

## Co-broking Agreement System - Production Configuration

This guide explains how to properly configure the system for production mode.

## ✅ Setup Complete

The production environment has been configured with the following:

### 1. Environment Variables

Your `.env` file is configured with:
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE` - Service role key for server-side operations
- `WABA_TOKEN` & `WABA_PHONE_ID` - WhatsApp Business API credentials

### 2. Supabase Storage

The `agreements` bucket has been created in Supabase Storage with:
- **Public access**: PDFs are publicly accessible via URL
- **File size limit**: 5MB maximum
- **Allowed MIME types**: `application/pdf` only

### 3. Production Features

- ✅ PDFs are uploaded to Supabase Storage
- ✅ Public URLs are generated for each agreement
- ✅ WhatsApp notifications are sent via WhatsApp Business API
- ✅ All data is stored in your production Supabase database

## Usage

### Creating an Agreement

1. Navigate to `/sign?aid=<agent-id>&lid=<listing-id>`
2. Fill in the form:
   - Commission Split (default: 50/50)
   - Buyer Requirements
   - Listing URL
3. Submit the form
4. The system will:
   - Generate a PDF agreement
   - Upload it to Supabase Storage
   - Save the record to `cobroke_agreements` table
   - Send WhatsApp notification to the agent
   - Display a summary page with download link

### API Endpoint

**POST** `/api/sign/submit`

Request body:
```json
{
  "aid": "agent-uuid",
  "lid": "listing-uuid",
  "commissionSplit": "50/50",
  "buyerRequirements": "2-bedroom condo, budget $1.5M, move-in by Q3",
  "listingUrl": "https://example.com/listing/123"
}
```

Response:
- Returns HTML summary page (200 OK)
- Or JSON error (400/500)

## Database Schema

The `cobroke_agreements` table contains:
```sql
create table cobroke_agreements(
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id),
  listing_url text,
  buyer_requirements text,
  commission_split text,
  pdf_url text,
  signed_at timestamptz
);
```

## Scripts

### Setup Storage Bucket
```bash
bun run storage:setup
```
Creates the Supabase Storage bucket if it doesn't exist.

### Database Migration
```bash
bun run db:migrate
```
Runs the initial schema migration (already includes `cobroke_agreements` table).

## Production Configuration

The system is configured for production use with:
- PDFs uploaded to Supabase Storage
- WhatsApp sends real messages via Business API
- All data stored in production database

## Troubleshooting

### PDFs Not Uploading
- Verify `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE` are set
- Check that the `agreements` bucket exists (run `bun run storage:setup`)
- Ensure the bucket has public access enabled

### WhatsApp Not Sending
- Verify `WABA_TOKEN` and `WABA_PHONE_ID` are set
- Check that the agent's phone number exists in the database
- Verify WhatsApp template is approved in Business Manager

### Agent Phone Not Found
- Ensure agents exist in the `agents` table with valid `phone` numbers
- Phone numbers should include country code (e.g., "6591234567")

## Security Notes

- `SUPABASE_SERVICE_ROLE` key should NEVER be exposed to the client
- API route runs server-side only
- All database operations use Row Level Security (if configured)
- PDF URLs are public but hard to guess (contains timestamp and UUIDs)

## Next Steps

1. ✅ Production mode is configured
2. ✅ Storage bucket is created
3. ✅ Environment variables are set
4. ✅ Database schema is ready

You're all set to start accepting co-broking agreements in production! 🚀

