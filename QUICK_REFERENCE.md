# 🚀 Quick Reference - PropertyDemo

## 🚨 #1 Rule: ALWAYS USE BUN

```bash
bun install        # ✅ YES
npm install        # ❌ NO - BLOCKED!
```

---

## 📁 Project Structure

```
propertydemo/
├── smartprop/              # Main app (Next.js + Bun)
│   ├── src/app/admin/
│   │   ├── articles/      # Article scraper
│   │   ├── scraper/       # Property scraper  
│   │   ├── agents/        # Agent management
│   │   ├── listings/      # Listings
│   │   └── outreach/      # WhatsApp outreach
│   └── migrations/        # Database schemas
└── landing/               # Marketing site
```

---

## ⚡ Common Commands

### Development
```bash
cd smartprop
bun install              # Install dependencies
bun dev                  # Start dev server (port 3000)
bun run build            # Build for production
```

### Adding UI Components
```bash
bun run shadcn add tabs       # Add tabs component
bun run shadcn add dialog     # Add dialog component
bun run shadcn add button     # Add button component
```

### Package Management
```bash
bun add react-hook-form          # Add dependency
bun add -D @types/node           # Add dev dependency  
bun remove package-name          # Remove package
bunx some-cli-tool              # Run CLI tools
```

### Scrapers
```bash
bun run auth:pg             # Auth PropertyGuru
bun run auth:ep             # Auth EdgeProp
bun run scrape:pg           # Scrape PropertyGuru
bun run scrape:ep           # Scrape EdgeProp
```

---

## 🌐 URLs

| Page | URL |
|------|-----|
| Admin Dashboard | http://localhost:3000/admin |
| Article Scraper | http://localhost:3000/admin/articles |
| Property Scraper | http://localhost:3000/admin/scraper |
| Agents | http://localhost:3000/admin/agents |
| Listings | http://localhost:3000/admin/listings |
| Outreach | http://localhost:3000/admin/outreach |
| Calendar | http://localhost:3000/admin/viewings |

---

## 📊 Database (Supabase)

```env
URL: pfdsmpfgwbbeijdzevpu.supabase.co
```

### Key Tables
- `listings` - Property listings
- `agents` - Real estate agents
- `scraped_articles` - News articles
- `scrape_sessions` - Scraping history
- `scraper_jobs` - Property scraper jobs
- `outreach` - WhatsApp conversations

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| Runtime | Bun |
| Framework | Next.js 15 |
| Database | Supabase (PostgreSQL) |
| UI | React + Tailwind + shadcn/ui |
| Scraping | Playwright |
| AI | Groq (LLaMA) |
| Real-time | SSE |
| WhatsApp | WAHA |
| Testing | Chrome DevTools MCP |

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| `USE_BUN.md` | How to use Bun (READ THIS!) |
| `BUN_ENFORCEMENT.md` | How npm is blocked |
| `ARTICLE_SCRAPER_V2.md` | Article scraper details |
| `ARCHITECTURE_COMPARISON.md` | Why scrapers work this way |
| `AI_FEATURES.md` | AI conversation features |
| `WAHA_SETUP.md` | WhatsApp integration |

---

## 🤖 MCP Servers (Model Context Protocol)

### Configured Servers

1. **Supabase MCP** - Database operations and migrations
2. **Chrome DevTools MCP** - Browser automation and testing

### Chrome DevTools MCP Usage

Chrome DevTools MCP is now configured and ready to use! You can ask me to:
- Navigate to web pages
- Fill out forms
- Click buttons
- Take screenshots
- Run performance tests
- Simulate network conditions
- Test responsive designs

**Example**: "Navigate to http://localhost:3000/admin and take a screenshot"

**Configuration**: Located in `.cursor/settings.json`

---

## 🔑 Key Patterns

### Server Component (Data Fetching)
```typescript
// page.tsx
export default async function Page() {
  const data = await getData(); // Fetch from DB
  return <Client initialData={data} />;
}
```

### Client Component (Interactivity)
```typescript
// Client.tsx
'use client';

export default function Client({ initialData }) {
  const [data, setData] = useState(initialData);
  // Interactive logic here
}
```

### Server Actions (Mutations)
```typescript
// actions.ts
'use server';

export async function updateData(formData: FormData) {
  await supabase.from('table').update(...);
  revalidatePath('/page');
  return { success: true };
}
```

---

## 🐛 Troubleshooting

### Port 3000 Already in Use
```bash
lsof -ti:3000 | xargs kill -9
bun dev
```

### Wrong Package Manager Used
```bash
rm -rf node_modules package-lock.json
bun install
```

### Database Connection Issues
Check `.env` file has:
```env
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE=...
```

### Playwright Browser Not Installed
```bash
bunx playwright install chromium
```

---

## 🎯 Common Tasks

### Add New Scraper Feature
1. Update `src/lib/scraper/`
2. Add server action in `actions.ts`
3. Update UI component
4. Test with small dataset first

### Add New Database Table
1. Create migration in `migrations/`
2. Apply via Supabase dashboard
3. Add TypeScript types
4. Create server actions

### Add New UI Component
```bash
bun run shadcn add component-name
# Edit: src/components/ui/component-name.tsx
```

### Deploy to Production
```bash
bun run build
# Deploy dist to Vercel/similar
# Set environment variables
```

---

## ⚠️ Common Mistakes

| ❌ Wrong | ✅ Right |
|----------|----------|
| `npm install` | `bun install` |
| `npx shadcn` | `bun run shadcn` |
| `npm run dev` | `bun dev` |
| Client Component fetching | Server Component fetching |
| Storing in state only | Storing in database |
| `useState` for persistent data | Server Actions + DB |

---

## 🚀 Getting Started (New Developer)

```bash
# 1. Install Bun
curl -fsSL https://bun.sh/install | bash

# 2. Clone repo
git clone <repo-url>
cd propertydemo/smartprop

# 3. Copy environment
cp .env.example .env
# Edit .env with real values

# 4. Install dependencies
bun install

# 5. Run dev server
bun dev

# 6. Open browser
open http://localhost:3000/admin
```

---

## 📞 Quick Help

**Problem**: npm is being used  
**Solution**: See `USE_BUN.md` - npm is now blocked

**Problem**: Data not persisting  
**Solution**: Use Server Components + Database, not Client state

**Problem**: Scraper not saving  
**Solution**: Check database connection and session creation

**Problem**: Components not found  
**Solution**: `bun run shadcn add component-name`

---

## 💡 Tips

1. **Always use bun** - It's enforced, but remember it consciously
2. **Server Components for data** - Fetch from DB, pass to Client
3. **Database for persistence** - Never rely on memory/state alone
4. **Follow existing patterns** - Property scraper = Article scraper
5. **Read the docs** - Check `USE_BUN.md` and `ARCHITECTURE_COMPARISON.md`

---

**Built with 🐰 Bun | 🔥 Next.js | ⚡ Supabase**

*Last Updated: [Auto-generated]*

