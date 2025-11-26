# 📘 SmartProp Admin User Guide

**Version:** 1.0  
**Last Updated:** November 2025

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Admin Dashboard Overview](#admin-dashboard-overview)
3. [Property Management](#property-management)
4. [Article Scraper](#article-scraper)
5. [Agent Management](#agent-management)
6. [Outreach & WhatsApp](#outreach--whatsapp)
7. [Viewing Calendar](#viewing-calendar)
8. [Property Scraper](#property-scraper)
9. [LinkedIn Automation](#linkedin-automation)
10. [Swipe Interface](#swipe-interface)
11. [AI Prompts Management](#ai-prompts-management)
12. [Co-Broking Analytics](#co-broking-analytics)
13. [Common Tasks](#common-tasks)
14. [Troubleshooting](#troubleshooting)
15. [Best Practices](#best-practices)

---

## Getting Started

### Accessing the Admin Dashboard

1. **Open your browser** and navigate to:
   - **Local Development**: `http://localhost:3000/admin`
   - **Production**: `https://your-domain.com/admin`

2. **Login** (if authentication is enabled)

3. You'll see the **Admin Dashboard** with quick access to all features

### First Time Setup

If you're setting up the system for the first time:

1. **Check Environment Variables**: Ensure all required environment variables are set (see Technical Setup section)
2. **Database Connection**: Verify connection to Supabase database
3. **WhatsApp Setup**: If using WhatsApp features, ensure WAHA is running (see WhatsApp Integration section)

---

## Admin Dashboard Overview

The Admin Dashboard (`/admin`) is your central hub for managing all aspects of the property system.

### Main Sections

| Section | URL | Purpose |
|---------|-----|---------|
| **Dashboard** | `/admin` | Overview and quick stats |
| **Listings** | `/admin/listings` | View and manage property listings |
| **Agents** | `/admin/agents` | Manage real estate agents |
| **Outreach** | `/admin/outreach` | Track WhatsApp conversations |
| **Viewings** | `/admin/viewings` | Calendar for property viewings |
| **Articles** | `/admin/articles` | Scrape and manage property news |
| **Scraper** | `/admin/scraper` | Configure property scrapers |
| **LinkedIn** | `/admin/linkedin` | LinkedIn automation for catch-ups |
| **Swipe** | `/admin/swipe` | Mobile-friendly swipe interface for viewings |
| **AI Prompts** | `/admin/ai-prompts` | Manage AI prompts for automation |
| **Co-Broking Analytics** | `/admin/cobroking-analytics` | Analytics for co-broking success rates |

### Dashboard Features

- **Quick Stats**: Total listings, agents, conversations, and more
- **Status Indicators**: Live updates on system health
- **Quick Actions**: One-click access to common tasks
- **Recent Activity**: Latest scrapes, new listings, agent responses

### Enhanced Pages (Experimental)

The system also includes enhanced versions of several pages with advanced features:

- **Enhanced Dashboard** (`/admin/dashboard-enhanced`) - Real-time analytics and system overview
- **Enhanced Listings** (`/admin/listings-enhanced`) - Property listings with live updates
- **Enhanced Agents** (`/admin/agents-enhanced`) - Agent management with co-broking analytics
- **Enhanced Conversations** (`/admin/outreach-enhanced`) - Real-time co-broking conversations
- **Enhanced Scraper** (`/admin/scraper-enhanced`) - Live scraping progress and job management

**Note**: Enhanced pages are experimental and may have different features than primary pages. Use primary pages for daily operations.

---

## Property Management

### Viewing Listings

**Location**: `/admin/listings`

#### Features

- **View All Listings**: Browse all 200+ property listings
- **Filter & Search**: 
  - Filter by district, price range, property type
  - Search by address, agent name, or listing ID
- **Expandable Rows**: Click any listing to see full details:
  - Property specifications (beds, baths, size)
  - Price and location
  - Agent contact information
  - Viewing status and timeslots
  - Property URL (link to original listing)
- **Status Tracking**: See viewing status (pending, requested, received)

#### Common Actions

1. **View Listing Details**: Click on any row to expand and see full information
2. **Filter Listings**: Use the filter panel on the left
3. **Search**: Type in the search box to find specific listings
4. **Edit Listings**: Click the edit icon to modify listing details

### Editing Listings

You can edit existing listings:

1. Navigate to `/admin/listings`
2. Click the edit icon on any listing row
3. Update the fields as needed
4. Click "Save" to update

**Note**: Most listings are automatically added by scrapers. Manual editing is typically used to correct or update existing listing information.

---

## Article Scraper

**Location**: `/admin/articles`

The Article Scraper collects property news and articles from EdgeProp Singapore.

### Starting a Scrape

1. **Navigate** to `/admin/articles`
2. **Select Tab**: Choose "Current Scrape" tab
3. **Set Pages**: Enter number of pages to scrape (1-624 pages available)
   - Each page contains ~20 articles
   - Example: 5 pages = ~100 articles
4. **Click "Start Scraping"**

### Monitoring Progress

- **Live Updates**: Watch real-time progress via Server-Sent Events (SSE)
- **Progress Bar**: Shows current page and total pages
- **Article Count**: See how many articles have been scraped
- **Time Estimate**: Approximate time remaining

**Performance**:
- **1 page (20 articles)**: ~1 minute
- **5 pages (100 articles)**: ~5 minutes
- **Full scrape (624 pages)**: ~10 hours (not recommended in one session)

### Viewing Scraped Articles

#### Library Tab

- **Browse All Articles**: View all scraped articles
- **Search**: Find articles by title, author, or category
- **Filter**: Filter by category, date, or tags
- **View Full Content**: Click any article to see:
  - Full HTML content
  - Full text (~5000 words)
  - All images (URLs)
  - All links
  - Article metadata
- **Article Detail Page**: Click on any article to view detailed page (`/admin/articles/[id]`)
  - Full article content with formatting
  - All images and links
  - Reading time and word count
  - Compare with other versions (if available)

#### History Tab

- **Session History**: View all past scraping sessions
- **Session Details**: See when each session ran, how many articles were scraped
- **Re-run Sessions**: Option to re-scrape specific sessions

### Exporting Articles

1. **Go to Library Tab**
2. **Select Articles**: Use checkboxes to select articles (or select all)
3. **Click Export**: Choose format:
   - **JSON**: Full article data with metadata
   - **CSV**: Simplified table format

### Article Content

Each article includes:
- **Metadata**: Title, author, category, publish date
- **Full HTML**: Complete article markup
- **Full Text**: Plain text version (~5000 words)
- **Images**: All image URLs from the article
- **Links**: All links with context
- **Tags**: Article tags and categories
- **Statistics**: Word count, reading time

---

## Agent Management

**Location**: `/admin/agents`

### Viewing Agents

- **Agent List**: See all agents with contact information
- **Contact Details**: Phone numbers, WhatsApp status
- **Co-broking Status**: Willing/not willing to co-broke
- **Associated Listings**: See all listings for each agent

### Agent Information

Each agent entry shows:
- **Name**: Agent's full name
- **Phone**: Contact number
- **WhatsApp**: WhatsApp availability status
- **Email**: Email address (if available)
- **Listings Count**: Number of properties listed
- **Co-broking Status**: Whether agent is open to co-broking

### Managing Agents

- **View Details**: Click on agent to see full profile
- **Contact Agent**: Use WhatsApp button to message directly
- **View Listings**: See all properties listed by this agent
- **Update Status**: Mark co-broking status

---

## Outreach & WhatsApp

**Location**: `/admin/outreach`

### Viewing Conversations

The Outreach page shows all WhatsApp conversations with agents.

#### Conversation List

- **Agent Name**: Who you're talking to
- **Property**: Which listing the conversation is about
- **Status**: 
  - `pending` - Message not sent yet
  - `requested` - Viewing request sent
  - `received` - Agent replied
  - `confirmed` - Viewing timeslots confirmed
- **Last Message**: Preview of most recent message
- **Timestamp**: When the last message was sent/received

### Viewing Conversation Details

Click on any conversation to see:
- **Full Message History**: All messages exchanged
- **Property Details**: Link to the listing
- **Viewing Timeslots**: Extracted available times (if agent replied)
- **AI Parsing**: Automatically extracted viewing times from agent messages

### Sending Viewing Requests

Viewing requests are typically sent automatically via jobs, but you can trigger manually:

1. **Via API** (for technical users):
   ```bash
   curl -X POST http://localhost:3000/api/jobs/viewing-request?limit=10
   ```

2. **Via Admin Interface**: 
   - Go to Scraper page
   - Use "Send Viewing Requests" button

### WhatsApp Integration

**Prerequisites**: WAHA (WhatsApp HTTP API) must be running.

**Setup**:
1. Start WAHA container: `docker compose up -d`
2. Open WAHA interface: `http://localhost:3030`
3. Scan QR code with WhatsApp
4. Configure webhook URL in WAHA settings

**Message Format**:
When agents receive viewing requests, they see:
```
Hi [Agent Name]! 👋

I'm interested in viewing this property:
📍 [Property Title]
🔗 [Property URL]

Could you please share the available viewing timeslots? Thank you! 🙏
```

### AI-Powered Features

- **Automatic Timeslot Parsing**: AI extracts viewing times from agent replies
- **Human-like Behavior**: 
  - Typing indicators
  - Realistic delays
  - Natural message variations

---

## Viewing Calendar

**Location**: `/admin/viewings`

### Calendar Views

- **Calendar View**: See all viewings in calendar format
- **List View**: List of all viewings
- **Timeline View**: Chronological timeline of viewings
- **Grid View**: Grid layout of viewings
- **Swipe View**: Mobile-friendly swipe interface

### Viewing Information

Each calendar event shows:
- **Property**: Property address and details
- **Time**: Scheduled viewing time
- **Agent**: Contact agent information
- **Status**: Confirmed, pending, or cancelled
- **Notes**: Additional information

### Managing Viewings

- **View Details**: Click on any viewing to see full details
- **Switch Views**: Use view mode buttons to change display format
- **Statistics**: View total viewings, today's count, this week's count, and unique properties
- **Filter**: Filter by agent, property, or status

**Note**: Viewings are typically added automatically when agents respond with available timeslots via WhatsApp.

---

## LinkedIn Automation

**Location**: `/admin/linkedin`

### Overview

The LinkedIn automation feature helps you maintain relationships by automatically sending catch-up messages for:
- **Birthdays**: Send birthday wishes
- **Work Anniversaries**: Congratulate on work milestones
- **Job Changes**: Reach out when contacts change jobs

### Features

- **Automated Messages**: Pre-configured messages for different occasions
- **Contact Management**: Track LinkedIn connections
- **Scheduling**: Schedule messages in advance
- **Message History**: View all sent messages

### Usage

1. **Navigate** to `/admin/linkedin`
2. **Review Contacts**: See upcoming birthdays, anniversaries, and job changes
3. **Configure Messages**: Customize message templates
4. **Send Messages**: Manually send or schedule automatic messages

**Note**: This feature requires LinkedIn authentication and proper setup. Contact the development team for initial configuration.

---

## Swipe Interface

**Location**: `/admin/swipe`

### Overview

The Swipe Interface provides a mobile-friendly, Tinder-like experience for browsing viewing slots.

### Features

- **Swipe Navigation**: Swipe left to pass, right to like viewing slots
- **Mobile Optimized**: Designed for touch interactions on mobile devices
- **Quick Actions**: Like or pass viewing slots with simple gestures
- **Visual Feedback**: Haptic feedback and animations for better UX
- **Slot Details**: View property details, agent info, and timeslot information

### Usage

1. **Navigate** to `/admin/swipe`
2. **Browse Slots**: View available viewing slots one at a time
3. **Swipe Right**: Like a viewing slot (saves to favorites)
4. **Swipe Left**: Pass on a viewing slot
5. **View Details**: Tap on a slot to see full property information

**Best For**: Quick browsing of viewing slots on mobile devices or tablets.

---

## AI Prompts Management

**Location**: `/admin/ai-prompts`

### Overview

Manage AI prompts used throughout the system for automated messaging and content generation.

### Features

- **Prompt Library**: View all AI prompts used in the system
- **Version Control**: Track different versions of prompts
- **Active/Inactive**: Enable or disable prompts
- **Edit Prompts**: Update prompt content and descriptions
- **Create New**: Add new prompts for different use cases

### Managing Prompts

1. **Navigate** to `/admin/ai-prompts`
2. **View Prompts**: See all available prompts with their status
3. **Edit**: Click edit to modify prompt content
4. **Toggle Status**: Activate or deactivate prompts
5. **Create New**: Add new prompts for specific scenarios

**Note**: Changes to prompts affect automated messaging. Test changes before activating.

---

## Co-Broking Analytics

**Location**: `/admin/cobroking-analytics`

### Overview

Deep insights into co-broking success rates, patterns, and trends to help optimize your outreach strategy.

### Features

- **Success Rate Analysis**: Overall co-broking success rates
- **Trend Tracking**: See how success rates change over time
- **Agent Performance**: Which agents are most willing to co-broke
- **Pattern Recognition**: Identify successful conversation patterns
- **Dealbreaker Analysis**: Understand why some agents decline

### Analytics Dashboard

- **Overview Metrics**: Total conversations, willing/not willing agents, success rates
- **Trends**: Success rate trends over time
- **Agent Insights**: Performance by individual agents
- **Conversation Analysis**: Breakdown by conversation phase
- **Recommendations**: Suggestions for improving success rates

### Usage

1. **Navigate** to `/admin/cobroking-analytics`
2. **Review Overview**: Check overall success metrics
3. **Analyze Trends**: Look at success rate trends over time
4. **Agent Performance**: Identify top-performing agents
5. **Optimize Strategy**: Use insights to improve outreach approach

**Best For**: Strategic planning and optimizing co-broking success rates.

---

## Property Scraper

**Location**: `/admin/scraper`

### Overview

The Property Scraper collects listings from:
- **PropertyGuru** (Singapore)
- **EdgeProp** (Singapore)

### Starting a Scrape

1. **Navigate** to `/admin/scraper`
2. **Select Platform**: Choose PropertyGuru or EdgeProp
3. **Configure Districts**: Select which districts to scrape
4. **Set Pages**: Choose how many pages per district
5. **Click "Start Scraping"**

### Authentication

Both scrapers require login credentials:

**PropertyGuru**:
- Email and password required
- Stored in environment variables: `PG_EMAIL`, `PG_PASSWORD`

**EdgeProp**:
- Email and password required
- Stored in environment variables: `EP_EMAIL`, `EP_PASSWORD`

**Note**: Credentials are managed by system administrators. Contact them if scraping fails due to authentication.

### Monitoring Scrapes

- **Live Progress**: Real-time updates on scraping progress
- **Current District**: Which district is being scraped
- **Pages Scraped**: Progress within current district
- **Listings Found**: Number of new listings discovered
- **Errors**: Any issues encountered

### Scrape History

- **View Past Scrapes**: See all previous scraping jobs
- **Job Details**: When it ran, how many listings found
- **Re-run Jobs**: Option to re-scrape specific jobs

### Data Quality Dashboard

- **Duplicate Detection**: See how many duplicates were prevented
- **Data Completeness**: Check if all fields are populated
- **Recent Listings**: Preview of newly scraped properties

### Scheduled Scrapes

Set up automatic scraping:

1. **Go to Scheduled Jobs Section**
2. **Click "Add Scheduled Job"**
3. **Configure**:
   - Platform (PropertyGuru/EdgeProp)
   - Districts
   - Schedule (daily, weekly, etc.)
   - Time
4. **Save**: Job will run automatically

---

## Common Tasks

### Daily Workflow

1. **Morning Check**:
   - Review dashboard for new listings
   - Check agent responses in Outreach
   - Review viewing calendar for today

2. **Scraping**:
   - Run property scraper for new listings (if needed)
   - Run article scraper for latest news (optional)

3. **Follow-ups**:
   - Review pending viewing requests
   - Follow up with agents who haven't responded
   - Update viewing calendar

4. **End of Day**:
   - Review all conversations
   - Update viewing statuses
   - Plan next day's viewings

### Weekly Tasks

- **Full Property Scrape**: Run comprehensive scrape of all districts
- **Article Library Update**: Scrape latest property news
- **Agent Database Review**: Verify agent contact information
- **Data Export**: Export listings and articles for backup

### Monthly Tasks

- **Database Cleanup**: Remove old/expired listings
- **Performance Review**: Check scraper success rates
- **Agent Outreach Analysis**: Review co-broking success rates

---

## Troubleshooting

### Scraper Issues

**Problem**: Scraper not starting
- **Solution**: Check authentication credentials in environment variables
- **Solution**: Verify internet connection
- **Solution**: Check if website is accessible (may be down)

**Problem**: Scraper running but finding no listings
- **Solution**: Check if districts are correct
- **Solution**: Verify login credentials are valid
- **Solution**: Check if website structure has changed (may need update)

**Problem**: Scraper timing out
- **Solution**: Reduce number of pages per district
- **Solution**: Increase timeout values (contact developer)
- **Solution**: Run scrapes during off-peak hours

### WhatsApp Issues

**Problem**: Messages not sending
- **Solution**: Check if WAHA is running: `docker compose ps`
- **Solution**: Verify WhatsApp session is active (scan QR code again)
- **Solution**: Check webhook configuration

**Problem**: Not receiving agent replies
- **Solution**: Verify webhook URL is correct
- **Solution**: Check WAHA logs: `docker compose logs waha`
- **Solution**: Ensure webhook endpoint is publicly accessible (for production)

### Database Issues

**Problem**: Data not appearing
- **Solution**: Refresh the page
- **Solution**: Check database connection status
- **Solution**: Verify RLS (Row Level Security) policies (contact developer)

**Problem**: Duplicate listings
- **Solution**: System should prevent duplicates automatically
- **Solution**: If duplicates appear, contact developer to check deduplication logic

### Performance Issues

**Problem**: Pages loading slowly
- **Solution**: Check internet connection
- **Solution**: Reduce number of items displayed (use filters)
- **Solution**: Clear browser cache

**Problem**: Scraper running slowly
- **Solution**: This is normal - scraping takes time to avoid detection
- **Solution**: Reduce number of pages if needed
- **Solution**: Run scrapes during off-peak hours

---

## Best Practices

### Scraping Best Practices

1. **Don't Over-scrape**: 
   - Run property scrapes 1-2 times per day maximum
   - Run article scrapes weekly or as needed
   - Avoid scraping during peak hours (9am-6pm)

2. **Monitor Progress**:
   - Keep scraper page open to monitor progress
   - Don't close browser during active scrape
   - Check for errors regularly

3. **Data Quality**:
   - Review scraped data for completeness
   - Report any missing fields to developers
   - Verify agent contact information

### Outreach Best Practices

1. **Timing**:
   - Send viewing requests during business hours (9am-6pm)
   - Avoid weekends unless urgent
   - Space out requests (don't send all at once)

2. **Follow-up**:
   - Follow up on pending requests after 24-48 hours
   - Be respectful of agent's time
   - Keep messages professional and concise

3. **Tracking**:
   - Update viewing status promptly
   - Add notes to conversations for context
   - Mark confirmed viewings in calendar

### Data Management

1. **Regular Backups**:
   - Export important data regularly
   - Keep backups of listings and articles
   - Document any manual changes

2. **Cleanup**:
   - Remove expired listings monthly
   - Archive old conversations
   - Clean up duplicate entries

3. **Verification**:
   - Verify agent contact information
   - Check property URLs are still valid
   - Update viewing timeslots when received

### Security

1. **Credentials**:
   - Never share login credentials
   - Report any security concerns immediately
   - Use strong passwords for all accounts

2. **Access Control**:
   - Only authorized personnel should access admin dashboard
   - Log out when finished
   - Don't share admin URLs publicly

---

## Quick Reference

### URLs

| Feature | URL |
|---------|-----|
| Dashboard | `/admin` |
| Listings | `/admin/listings` |
| Agents | `/admin/agents` |
| Outreach | `/admin/outreach` |
| Viewings | `/admin/viewings` |
| Articles | `/admin/articles` |
| Scraper | `/admin/scraper` |
| LinkedIn | `/admin/linkedin` |
| Swipe | `/admin/swipe` |
| AI Prompts | `/admin/ai-prompts` |
| Co-Broking Analytics | `/admin/cobroking-analytics` |

### Status Meanings

| Status | Meaning |
|--------|---------|
| `pending` | Action not yet taken |
| `requested` | Request sent, waiting for response |
| `received` | Response received, processing |
| `confirmed` | Action completed successfully |
| `error` | Something went wrong |

---

## Support & Contact

### Getting Help

1. **Check This Guide**: Most common questions are answered here
2. **Check Troubleshooting**: See Troubleshooting section above
3. **Contact Developer**: For technical issues or bugs
4. **Check Logs**: Review system logs for error details

### Reporting Issues

When reporting issues, please include:
- **What you were doing**: Step-by-step actions
- **What happened**: Error message or unexpected behavior
- **When it happened**: Date and time
- **Screenshots**: If applicable
- **Browser/Device**: Browser type and version

### Feature Requests

Have an idea for improvement? Contact the development team with:
- **Feature Description**: What you'd like to see
- **Use Case**: How it would help your workflow
- **Priority**: How important it is

---

## Appendix

### System Requirements

- **Browser**: Chrome, Firefox, Safari, or Edge (latest versions)
- **Internet**: Stable connection required
- **Screen Resolution**: Minimum 1280x720 recommended

### Data Limits

- **Listings**: No hard limit (currently 200+)
- **Articles**: 12,470+ articles available
- **Agents**: 150+ agents in database
- **Conversations**: Unlimited

### Performance Metrics

- **Page Load**: < 2 seconds
- **Scraper Speed**: ~20 articles/minute
- **Search**: < 500ms
- **Real-time Updates**: < 1 second

---

**Last Updated**: November 2025  
**Version**: 1.0  
**Maintained by**: SmartProp Development Team

---

*For technical documentation, see `README.md` and other documentation files in the project.*

