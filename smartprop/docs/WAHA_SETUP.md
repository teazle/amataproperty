# WAHA Setup Guide

This guide explains how to set up WAHA (WhatsApp HTTP API) for automated viewing timeslot requests.

> We pin WAHA to `devlikeapro/waha:arm-2025.9.8`, the Apple Silicon build of the 2025.9 release. On x86, use `devlikeapro/waha:latest-2025.9.8`. This release does not require an API key, so no extra configuration is needed.

## 🎯 What WAHA Does

After scraping property listings, WAHA automatically:
1. Sends WhatsApp messages to agents requesting viewing timeslots
2. Receives and parses agent replies
3. Updates the database with viewing timeslot information

## 🚀 Quick Start

### 1. Install Docker (if not already installed)

```bash
# macOS (using Homebrew)
brew install --cask docker

# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

### 2. Start WAHA

```bash
# From the smartprop directory
docker compose pull waha
docker compose up -d

# Check logs
docker compose logs -f waha
```

### 3. Configure WhatsApp Session

1. Open http://localhost:3030 in your browser
2. Create a new session named `default`
3. Scan the QR code with your WhatsApp mobile app:
   - Open WhatsApp on your phone
   - Go to Settings → Linked Devices → Link a Device
   - Scan the QR code shown in the browser

### 4. Configure Environment Variables

Copy the WAHA configuration from `env.example` to your `.env` file:

```bash
# WAHA (WhatsApp HTTP API) Configuration
WAHA_URL=http://localhost:3030
WAHA_SESSION=default

# Your public URL (for webhooks in production)
PUBLIC_BASE_URL=http://localhost:3000  # Change to your domain in production
```

No API key is required for this build—just ensure the URL and session values match your docker-compose configuration.

### 5. Run Database Migration

```bash
npm run db:migrate  # Or use your migration script
# Run: migrations/004_add_viewing_timeslots.sql
```

## 📊 Usage Workflow

### Automatic Flow

1. **Scrape listings** → Listings saved with `viewing_status='pending'`
2. **Run viewing request job** → Messages sent to agents
3. **Agent replies** → WAHA webhook receives reply
4. **Database updated** → Viewing timeslots saved

### Manual Trigger

#### Send viewing requests for pending listings:

```bash
curl -X POST http://localhost:3000/api/jobs/viewing-request?limit=10
```

#### Check status:

```bash
curl http://localhost:3000/api/jobs/viewing-request
```

Response:
```json
{
  "success": true,
  "stats": {
    "pending": 5,
    "requested": 15,
    "received": 8,
    "failed": 0
  }
}
```

#### Send a test message:

```bash
curl -X POST http://localhost:3000/api/wa/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "6591234567",
    "text": "Test message from WAHA!"
  }'
```

#### Send a viewing request:

```bash
curl -X POST http://localhost:3000/api/wa/send \
  -H "Content-Type: application/json" \
  -d '{
    "type": "viewing_request",
    "to": "6591234567",
    "agentName": "John Tan",
    "propertyTitle": "Beautiful 3BR Condo in District 9",
    "propertyUrl": "https://propertyguru.com.sg/listing/123"
  }'
```

## 🔄 Webhook Setup

WAHA needs to send incoming messages to your webhook endpoint.

### Development (Local)

Already configured in `docker-compose.yml`:
```yaml
- WHATSAPP_HOOK_URL=http://localhost:3000/api/wa/webhook
```

### Production

1. Update `PUBLIC_BASE_URL` in your `.env`:
   ```
   PUBLIC_BASE_URL=https://yourdomain.com
   ```

2. Restart WAHA:
   ```bash
   docker compose down
   docker compose up -d
   ```

3. Ensure your webhook endpoint is publicly accessible:
   ```
   https://yourdomain.com/api/wa/webhook
   ```

## 📱 Phone Number Format

Always use international format **without** the `+` symbol:

- ✅ Correct: `6591234567` (Singapore)
- ❌ Wrong: `+6591234567`
- ❌ Wrong: `91234567` (missing country code)

The system automatically adds `@c.us` suffix for WhatsApp format.

## 🔧 Database Schema

### New Columns in `listings` table:

| Column | Type | Description |
|--------|------|-------------|
| `viewing_requested_at` | TIMESTAMPTZ | When viewing request was sent |
| `viewing_timeslots` | TEXT | Agent's viewing timeslot response |
| `viewing_status` | TEXT | Status: pending, requested, received, failed |

### New Columns in `outreach` table:

| Column | Type | Description |
|--------|------|-------------|
| `message_text` | TEXT | Message sent to agent |
| `reply_text` | TEXT | Agent's reply |
| `replied_at` | TIMESTAMPTZ | When agent replied |

## 🎨 Example Message

When a viewing request is sent, the agent receives:

```
Hi John Tan! 👋

I'm interested in viewing this property:
📍 Beautiful 3BR Condo in District 9
🔗 https://propertyguru.com.sg/listing/123

Could you please share the available viewing timeslots? Thank you! 🙏
```

## ⚡ Rate Limiting

To avoid being flagged by WhatsApp:

- **Default**: 1 second delay between messages
- **Recommended**: Send max 10-20 messages per batch
- **Schedule**: Run viewing request job every few hours, not continuously

## 🛠️ Troubleshooting

### WAHA container won't start

```bash
# Check logs
docker compose logs waha

# Restart
docker compose restart waha
```

### QR code expired

```bash
# Stop and restart to get new QR code
docker compose restart waha
```

### Messages not sending

1. Check WAHA is connected:
   - Visit http://localhost:3030
   - Check session status (should be "CONNECTED")

2. Check environment variables:
   ```bash
   cat .env | grep WAHA
   ```

3. Test API directly:
   ```bash
   curl http://localhost:3030/api/sessions
   ```

### Webhook not receiving messages

1. Check webhook URL is correct:
   ```bash
   docker compose exec waha env | grep HOOK
   ```

2. Check webhook endpoint is accessible:
   ```bash
   curl http://localhost:3000/api/wa/webhook
   ```

3. Check logs:
   ```bash
   # WAHA logs
   docker compose logs -f waha
   
   # Next.js logs
   npm run dev
   ```

## 🔒 Security Notes

### For Production (2025.9 build):

- **Restrict network access**: Keep WAHA behind your private network or proxy if you expose it beyond localhost.
- **Use HTTPS** for webhooks:
   ```
   PUBLIC_BASE_URL=https://yourdomain.com
   ```

- **Firewall rules**: Only allow your app to access WAHA port 3000 (host port 3030 in docker-compose)

- **Backup session data**:
   ```bash
   docker run --rm -v smartprop-waha-sessions:/data -v $(pwd):/backup \
     alpine tar czf /backup/waha-session-backup.tar.gz -C /data .
   ```

## 📈 Monitoring

View outreach statistics in the admin panel:

```
http://localhost:3000/admin/outreach
```

Or query directly:

```sql
SELECT 
  status,
  COUNT(*) as count
FROM outreach
WHERE channel = 'whatsapp'
GROUP BY status;
```

## 🚨 Important Notes

1. **WhatsApp Terms of Service**: WAHA uses WhatsApp Web protocol, which is technically against WhatsApp Business ToS. Use at your own risk.

2. **Account Safety**: 
   - Don't send spam
   - Space out messages (1-2 seconds between)
   - Use a dedicated WhatsApp number
   - Monitor for warnings

3. **Backup**: Regular backups of WAHA session data are recommended to avoid re-scanning QR codes.

## 🆚 WAHA vs WhatsApp Business API

| Feature | WAHA (Free) | WhatsApp Business API (Paid) |
|---------|-------------|------------------------------|
| Cost | Free | ~$0.01-0.05 per message |
| Setup | 5 minutes | Days (approval needed) |
| Templates | Not required | Required & must be approved |
| API | REST API | REST API |
| Risk | Against ToS | Official |
| Best for | Testing, SMBs | Production, Enterprise |

## 📚 Additional Resources

- WAHA Documentation: https://waha.devlike.pro
- WAHA GitHub: https://github.com/devlikeapro/waha
- WhatsApp Web Protocol: https://github.com/WhiskeySockets/Baileys
### Wrong image version

1. Stop and remove the running container:
   ```bash
   docker compose down
   ```
2. Remove cached images (optional but ensures a clean pull):
   ```bash
   docker image rm devlikeapro/waha:arm-2025.6.4 || true
   docker image rm devlikeapro/waha:arm-2025.9.8 || true
   ```
3. Pull and restart:
   ```bash
   docker compose pull waha
   docker compose up -d
   ```
