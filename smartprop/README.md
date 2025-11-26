# SmartProp 🏠

An intelligent property listing scraper with automated WhatsApp outreach for viewing timeslot requests.

## Features ✨

- 🕷️ **Automated Scraping**: Scrapes property listings from PropertyGuru and EdgeProp
- 📊 **Structured Data**: Extracts beds, baths, size, price, district, agent info, and more
- 💬 **WhatsApp Automation**: Automatically messages agents to request viewing timeslots via WAHA
- 🗄️ **Smart Deduplication**: Prevents duplicate listings and agents using database constraints
- 📱 **Webhook Integration**: Receives and parses agent replies automatically
- 🎯 **Job Scheduling**: Automated viewing request jobs with rate limiting
- 🏢 **Admin Dashboard**: View listings, agents, and outreach status
- 📰 **Article Scraper**: Scrapes property news from EdgeProp with full content extraction
- 🤖 **AI Features**: Intelligent viewing timeslot parsing and human-like behavior simulation

## Tech Stack 🛠️

- **Framework**: Next.js 15 (App Router)
- **Runtime**: Bun (not Node.js)
- **Database**: PostgreSQL + Supabase
- **Scraping**: Playwright (stealth mode)
- **WhatsApp**: WAHA (WhatsApp HTTP API)
- **Styling**: TailwindCSS + shadcn/ui + Magic UI components
- **Language**: TypeScript
- **AI**: Groq (LLaMA models)

## Quick Start 🚀

### 1. Prerequisites

- Bun (not Node.js)
- Docker & Docker Compose
- Supabase account

### 2. Installation

```bash
# Clone and install
cd smartprop
bun install

# Configure environment
cp env.example .env
# Edit .env with your configuration

# Run database migrations (via Supabase dashboard)
```

### 3. Start WAHA (WhatsApp Integration)

```bash
# Quick start script
./scripts/quick-start-waha.sh

# Or manually with Docker Compose
docker compose pull waha
docker compose up -d

# Open http://localhost:3030 and scan QR code
```

See [WAHA_SETUP.md](./WAHA_SETUP.md) for detailed WhatsApp setup instructions.

### 4. Start Development Server

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Usage 📖

### Scrape Property Listings

```bash
# Scrape PropertyGuru (with login)
bun run scrape:pg

# Scrape EdgeProp (with login)
bun run scrape:ep
```

Listings are automatically saved to the database with `viewing_status='pending'`.

### Send Viewing Requests to Agents

```bash
# Send viewing requests for all pending listings (max 10)
curl -X POST http://localhost:3000/api/jobs/viewing-request?limit=10

# Check viewing request status
curl http://localhost:3000/api/jobs/viewing-request

# Test WAHA integration
bun run test-waha 6591234567
```

### Scrape Property Articles

```bash
# Via UI: http://localhost:3000/admin/articles
# Or programmatically:
import { scrapeEdgePropUnified } from '@/lib/scraper/edgeprop-unified-scraper';

const articles = await scrapeEdgePropUnified(5, (progress) => {
  console.log(`Page: ${progress.currentPage}/${progress.totalPages}`);
}, sessionId);
```

### View Data

Access the admin dashboards:

- **Listings**: http://localhost:3000/admin/listings
- **Agents**: http://localhost:3000/admin/agents
- **Outreach**: http://localhost:3000/admin/outreach
- **Viewings**: http://localhost:3000/admin/viewings
- **Articles**: http://localhost:3000/admin/articles
- **Scraper**: http://localhost:3000/admin/scraper

## Architecture 🏗️

```
smartprop/
├── src/
│   ├── app/                    # Next.js app router
│   │   ├── admin/             # Admin dashboards
│   │   ├── api/               # API routes
│   │   │   ├── jobs/          # Job triggers
│   │   │   └── wa/            # WhatsApp endpoints
│   │   └── page.tsx           # Landing page
│   ├── components/            # UI components
│   │   └── ui/                # shadcn/ui components
│   ├── jobs/                  # Background jobs
│   │   ├── match.ts           # Property matching
│   │   └── viewing-request.ts # WhatsApp automation
│   ├── lib/                   # Utilities
│   │   ├── ai/                # AI features
│   │   ├── db/                # Database operations
│   │   └── scraper/           # Scraping logic
│   └── workers/               # Scrapers
│       ├── pg.live.ts         # PropertyGuru scraper
│       ├── ep.live.ts         # EdgeProp scraper
│       └── edgeprop-unified-scraper.ts # Article scraper
├── migrations/                # SQL migrations
├── scripts/                   # Utility scripts
├── docker-compose.yml         # WAHA container
└── WAHA_SETUP.md             # WhatsApp setup guide
```

## Database Schema 📊

### Tables

- **agents**: Property agents with contact info
- **listings**: Scraped property listings with viewing timeslots
- **outreach**: WhatsApp message tracking
- **scraped_articles**: Property news articles (metadata)
- **article_full_content**: Full article content (HTML, text, images)
- **scrape_sessions**: Article scraping sessions
- **scraper_jobs**: Property scraping jobs
- **cobroke_agreements**: Co-broking agreements (future)

See [migrations/](./migrations/) for full schema.

## Article Scraper Features 📰

### Unified Scraper System

**One powerful scraper** that does everything in a single pass:

1. **Discovers articles** from EdgeProp API (20 per page)
2. **Visits each article** page individually
3. **Extracts complete content**:
   - Full HTML markup
   - Full text content (~5000 words)
   - All paragraphs (array)
   - All image URLs (array)
   - All links (array with context)
   - Article tags
   - Word count & reading time
4. **Saves everything** to database

### Performance

- **1 page (20 articles)**: ~1 minute
- **5 pages (100 articles)**: ~5 minutes
- **Storage**: ~50 KB per article (URLs only, not binary)

### Database Storage

**Two tables per article:**
- `scraped_articles`: Metadata (title, author, category, etc.)
- `article_full_content`: Full content (HTML, text, images, links)

**Media Storage**: URLs only (not binary files) for efficiency.

## AI Features 🤖

### Viewing Timeslot Parsing

Automatically extracts and structures viewing timeslots from agent messages using Groq AI:

**BEFORE (Simple Parser):**
```
"Sure thing....Monday to Friday 9am to 9pm"
```

**AFTER (AI Parser):**
```json
{
  "available": true,
  "slots": [
    { "day": "Monday", "date": "2025-01-13", "time": "9am-9pm" },
    { "day": "Tuesday", "date": "2025-01-14", "time": "9am-9pm" }
  ]
}
```

### Human-Like Behavior

- ⌨️ **Typing indicators** ("composing" status shown to agent)
- ⏱️ **Realistic typing delays** (based on message length)
- 🎭 **Response variations** (multiple phrasings for same intent)
- 🧠 **Context-aware timing** (adjusts delay based on conversation phase)

### Groq AI Setup (Free!)

1. Get free API key at https://console.groq.com/keys
2. Add to `.env`: `GROQ_API_KEY=gsk_your_key_here`
3. Restart server: `bun dev`

**Free tier**: 14,400 requests/day (more than enough!)

## WhatsApp Integration 💬

### How It Works

1. **After Scraping**: Listings are saved with `viewing_status='pending'`
2. **Job Runs**: `/api/jobs/viewing-request` sends WhatsApp messages to agents
3. **Agent Replies**: WAHA webhook receives replies at `/api/wa/webhook`
4. **Database Updated**: Viewing timeslots are extracted and saved
5. **Status Changes**: `pending` → `requested` → `received`

### Message Example

Agents receive:

```
Hi John Tan! 👋

I'm interested in viewing this property:
📍 Beautiful 3BR Condo in District 9
🔗 https://www.propertyguru.com.sg/listing/123

Could you please share the available viewing timeslots? Thank you! 🙏
```

### Configuration

```env
# WAHA Configuration
WAHA_URL=http://localhost:3030
WAHA_SESSION=default

# Webhook URL (for production)
PUBLIC_BASE_URL=https://yourdomain.com
```

The provided `docker-compose.yml` pins WAHA to `devlikeapro/waha:arm-2025.9.8`, the Apple Silicon build of the 2025.9 release. On x86 hosts, swap the image to `devlikeapro/waha:latest-2025.9.8`.

## API Endpoints 🔌

### WhatsApp

- `POST /api/wa/send` - Send WhatsApp message
- `POST /api/wa/webhook` - Receive WAHA webhooks

### Jobs

- `POST /api/jobs/viewing-request` - Send viewing requests
- `GET /api/jobs/viewing-request` - Get viewing request stats
- `POST /api/jobs/match` - Match properties (future)

### Articles

- `POST /api/articles/scrape` - Start article scraping
- `GET /api/articles` - Get scraped articles
- `GET /api/articles/stats` - Get scraping statistics

## Environment Variables 🔐

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE=your_service_role_key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# WAHA
WAHA_URL=http://localhost:3000
WAHA_SESSION=default

# AI
GROQ_API_KEY=your_groq_api_key

# Scrapers
HEADLESS=true
PG_EMAIL=your_pg_email@example.com
PG_PASSWORD=your_pg_password
PG_MAX_PAGES=3
EP_EMAIL=your_ep_email@example.com
EP_PASSWORD=your_ep_password
EP_MAX_PAGES=3

# Application
PUBLIC_BASE_URL=http://localhost:3000
```

## Scripts 📜

```bash
# Scrapers
bun run scrape:pg          # Scrape PropertyGuru
bun run scrape:ep          # Scrape EdgeProp

# Testing
bun run test-waha [phone]  # Test WhatsApp
bun run test-scrapers      # Test scrapers

# Database
bun run db:query           # Run SQL queries
bun run db:migrate         # Apply migrations

# WAHA
./scripts/quick-start-waha.sh  # Start WAHA
```

## Production Deployment 🚀

See [PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md) for deployment instructions.

### Key Steps:

1. Set up PostgreSQL database (Supabase recommended)
2. Deploy Next.js app (Vercel recommended)
3. Deploy WAHA container (VPS or cloud)
4. Configure webhooks with public URL
5. Set up cron jobs for scraping and viewing requests

## Development 🔧

```bash
# Start dev server
bun dev

# Start WAHA
docker compose up -d

# View WAHA logs
docker compose logs -f waha

# Run linter
bun run lint

# Type checking
bun run type-check
```

## Troubleshooting 🔍

### WAHA Issues

```bash
# Check WAHA status
curl http://localhost:3000/api/sessions

# Restart WAHA
docker compose restart waha

# View logs
docker compose logs waha
```

### Scraper Issues

- **Anti-bot detection**: Scrapers use stealth mode, but websites may still block. Try adjusting delays.
- **Login fails**: Update credentials in `.env`
- **Timeout errors**: Increase timeout values in scraper code

### Database Issues

```bash
# Check connection
psql $DATABASE_URL -c "SELECT version();"

# View listings
psql $DATABASE_URL -c "SELECT COUNT(*) FROM listings;"
```

### AI Issues

```bash
# Test Groq API
curl https://api.groq.com/openai/v1/models \
  -H "Authorization: Bearer $GROQ_API_KEY"
```

See [WAHA_SETUP.md](./WAHA_SETUP.md) for more troubleshooting tips.

## Roadmap 🗺️

- [x] AI-powered viewing timeslot parsing
- [x] Property matching with buyer requirements
- [x] Full article content scraping
- [x] Real-time WhatsApp integration
- [ ] Co-broking agreement PDF generation
- [ ] Multi-language support
- [ ] SMS fallback for non-WhatsApp agents
- [ ] Email automation
- [ ] Analytics dashboard

## License 📄

MIT

## Contributing 🤝

Contributions welcome! Please open an issue or PR.

## Support 💬

For issues and questions:
- **👥 Admins**: See [ADMIN_USER_GUIDE.md](./ADMIN_USER_GUIDE.md) for complete user guide
- Open a GitHub issue
- See [WAHA_SETUP.md](./WAHA_SETUP.md) for WhatsApp help
- Check [PRODUCTION_SETUP.md](./PRODUCTION_SETUP.md) for deployment help
- See [AI_FEATURES.md](./AI_FEATURES.md) for AI setup help

---

**Built with 🐰 Bun | 🔥 Next.js | ⚡ Supabase | 🤖 Groq AI**
