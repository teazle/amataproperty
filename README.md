# PropertyDemo

Property management and scraping platform.

## 🚨 IMPORTANT: Use Bun, Not npm!

This project uses **Bun** exclusively. See `smartprop/USE_BUN.md` for details.

```bash
# ✅ Correct
bun install
bun dev

# ❌ Wrong
npm install
npm run dev
```

---

## 🏠 SmartProp Admin

Complete property management admin dashboard with integrated article scraper.

**Location**: `smartprop/`
**Access**: http://localhost:3000/admin

```bash
cd smartprop
bun install
bun dev
```

## ✨ Features

### Property Management
- ✅ Agent management
- ✅ Listing management
- ✅ Outreach tracking
- ✅ Viewing calendar
- ✅ Property scraper (PropertyGuru & EdgeProp)
- ✅ Swipe interface

### Article Scraper
- ✅ Real-time article scraping from EdgeProp Singapore
- ✅ ~12,470 articles across 624 pages
- ✅ Persistent database storage
- ✅ Search and filter capabilities
- ✅ Export to JSON/CSV
- ✅ Server-Sent Events (SSE) for live updates
- ✅ Playwright-based API interception
- ✅ Session tracking and history
- ✅ 3-tab interface: Current Scrape | Library | History

## 🚀 Quick Start

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Clone and setup
cd smartprop
bun install
bun dev
```

Then access:
- **Main Admin**: http://localhost:3000/admin
- **Article Scraper**: http://localhost:3000/admin/articles
- **Property Scraper**: http://localhost:3000/admin/scraper

## 📖 Documentation

- `smartprop/USE_BUN.md` - **READ THIS!** How to use Bun properly
- `smartprop/ARTICLE_SCRAPER_V2.md` - Article scraper technical details
- `smartprop/ARCHITECTURE_COMPARISON.md` - Why scrapers are built this way
- `smartprop/AI_FEATURES.md` - AI capabilities
- `smartprop/WAHA_SETUP.md` - WhatsApp integration

## 🗄️ Database

Using Supabase PostgreSQL:
- Connection: `pfdsmpfgwbbeijdzevpu.supabase.co`
- Migrations: `smartprop/migrations/`
- Tables: listings, agents, scraped_articles, scrape_sessions, etc.

## 🛠️ Tech Stack

- **Framework**: Next.js 15 with App Router
- **Runtime**: Bun (not Node.js)
- **Database**: Supabase (PostgreSQL)
- **UI**: React + Tailwind + shadcn/ui
- **Scraping**: Playwright
- **AI**: Groq (LLaMA models)
- **Real-time**: Server-Sent Events (SSE)
- **WhatsApp**: WAHA (WhatsApp HTTP API)

## 📦 Project Structure

```
propertydemo/
├── smartprop/                 # Main application
│   ├── src/
│   │   ├── app/
│   │   │   └── admin/
│   │   │       ├── articles/  # Article scraper
│   │   │       ├── scraper/   # Property scraper
│   │   │       ├── agents/    # Agent management
│   │   │       ├── listings/  # Listing management
│   │   │       ├── outreach/  # Outreach tracking
│   │   │       └── viewings/  # Calendar
│   │   ├── components/        # UI components
│   │   ├── lib/              # Utilities & helpers
│   │   └── workers/          # Scraper workers
│   └── migrations/           # Database migrations
└── landing/                  # Marketing site
```

## 🔑 Environment Variables

Required in `smartprop/.env`:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE=your_service_role_key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
GROQ_API_KEY=your_groq_api_key
```

## 🧪 Development

```bash
cd smartprop

# Development server
bun dev

# Build for production
bun run build

# Start production server
bun start

# Add shadcn components
bun run shadcn add button

# Add dependencies
bun add package-name
bun add -D dev-package
```

## 📊 Article Scraper Features

- **Live Scraping**: Real-time progress with SSE
- **Persistent Storage**: All articles saved to database
- **Library View**: Browse all scraped articles
- **History View**: Track all scraping sessions
- **Search & Filter**: Find articles by title, category
- **Export**: Download as JSON or CSV
- **Deduplication**: Tracks article scrape count
- **Session Tracking**: Full audit trail

## 🎯 Common Tasks

### Run Property Scraper
1. Go to http://localhost:3000/admin/scraper
2. Select platform (PropertyGuru or EdgeProp)
3. Configure districts and pages
4. Start scraping

### Run Article Scraper
1. Go to http://localhost:3000/admin/articles
2. Set number of pages (1-624)
3. Click "Start Scraping"
4. View results in Library tab

### Add New UI Components
```bash
# Always use bun, not npx!
bun run shadcn add dialog
bun run shadcn add toast
```

## ⚠️ Important Notes

1. **Always use `bun`, never `npm`** - See USE_BUN.md
2. **Database migrations** - Apply via Supabase dashboard or MCP
3. **Scraper workers** - Run independently from Next.js
4. **WhatsApp integration** - Requires WAHA setup

## 🤝 Contributing

1. Use Bun for all commands
2. Follow existing patterns (Server Components for data fetching)
3. Keep scrapers consistent with existing architecture
4. Add migrations for database changes
5. Document new features

---

**Built with 🐰 Bun | 🔥 Next.js | ⚡ Supabase**
