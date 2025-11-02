# 🎨 UI Features & Interfaces

Complete guide to all user interface features and viewing pages.

---

## Table of Contents

1. [Viewing Calendar](#viewing-calendar)
2. [Mobile Swipe Interface](#mobile-swipe-interface)
3. [Listings Display](#listings-display)
4. [Frontend Pages Overview](#frontend-pages-overview)

---

## Viewing Calendar

### Overview

Beautiful calendar interface to view and manage all property viewing timeslots in one organized place!

### Access

Open your browser to: **http://localhost:3000/admin/viewings**

### Features

**1. Interactive Calendar View**
- 📅 Week/Month/Day/Agenda views
- 🎨 Color-coded by property (each property has unique color)
- 🖱️ Click on any slot to see full details
- 📱 Fully responsive design

**2. Smart Timeslot Parsing**
- 🤖 AI automatically converts agent replies to calendar events
- ⏰ Handles various time formats (9am, 3:30pm, morning, afternoon)
- 📆 Supports days of week and specific dates
- 🔄 Automatically calculates next occurrence of "Monday", "Tuesday", etc.

**3. Beautiful UI with Magic UI Components**
- ✨ Animated list for upcoming viewings
- 💫 Smooth hover effects on cards
- 🎯 Clean, modern design
- 🌈 Color-coded property badges

### Multiple Views

- **Week View**: See all viewings for the current week
- **Month View**: Overview of the entire month
- **Day View**: Detailed hourly breakdown
- **Agenda View**: List view of all scheduled viewings

### View Modes

The viewing page offers 5 different visualization modes:

**1. Calendar View** (Default)
- Full interactive calendar with time slots
- Click to select and see details
- Property color coding

**2. List View**
- Table format with all viewing details
- Sortable columns
- Full agent and property information

**3. Timeline View**
- Horizontal timeline by property
- See multiple slots per property
- Easy comparison across days

**4. Grid View**
- Card-based layout
- Perfect for quick scanning
- Shows key information at a glance

**5. Swipe View**
- Tinder-style card interface
- Swipe right to like, left to pass
- Track liked vs passed viewings
- Mobile-optimized

### Smart Parsing Examples

**Example 1: Specific Times**
```
Input: "Monday 3pm, Tuesday 10:30am"
Output: 
  - Monday 3:00 PM - 4:00 PM
  - Tuesday 10:30 AM - 11:30 AM
```

**Example 2: Time Ranges**
```
Input: "Monday 9am-5pm"
Output: Monday 9:00 AM - 5:00 PM
```

**Example 3: Time of Day**
```
Input: "Monday morning, Wednesday afternoon, Friday evening"
Output:
  - Monday 10:00 AM - 12:00 PM (morning)
  - Wednesday 2:00 PM - 5:00 PM (afternoon)
  - Friday 6:00 PM - 8:00 PM (evening)
```

**Example 4: Relative Days**
```
Input: "Today 3pm, Tomorrow 10am"
Output:
  - Today at 3:00 PM
  - Tomorrow at 10:00 AM
```

### UI Components

**Left Side: Calendar**
- Full interactive calendar
- Drag-free navigation
- Zoom in/out on specific days
- Smooth animations

**Right Side: Details Panel**
Shows selected viewing:
- 🏠 Property name
- 📍 Address
- 💰 Price
- 👤 Agent name & phone
- 📅 Exact date/time
- 🏷️ District badge

**Bottom Right: Upcoming List**
- Next 5 upcoming viewings
- Sorted chronologically
- Quick access to details
- Animated list transitions

---

## Mobile Swipe Interface

### Overview

A **smooth, mobile-first web app** with native-like animations and gestures. Optimized for mobile devices and can be installed as a Progressive Web App (PWA)!

### Access

**Desktop:** http://localhost:3000/admin/swipe
**Mobile:** http://localhost:3000/admin/swipe (best experience)

### Features

**1. Super Smooth Animations**
- **60fps performance** with hardware acceleration
- **Spring-based physics** for natural feeling swipes
- **Buttery smooth transitions** between states
- **Anticipation & follow-through** animations for professional feel

**2. Enhanced Mobile Gestures**
- **Swipe left** (Pass ✕) or **right** (Like ❤️) with responsive drag physics
- **Haptic feedback** - Feel vibrations when you swipe (on supported devices)
- **Lower swipe threshold** (120px) for easier mobile interaction
- **Visual feedback** with colored overlays and indicators

**3. Mobile-Optimized UI**
- **100dvh viewport** - Uses full mobile screen height
- **Safe area support** - Respects iPhone notches and Android navigation bars
- **Fullscreen experience** - No admin navbar on this page
- **Touch-optimized buttons** - Larger tap targets
- **Responsive sizing** - Scales perfectly from small phones to tablets

**4. PWA Capabilities**
- **Installable** - Add to home screen on iOS/Android
- **Standalone mode** - Runs like a native app
- **Portrait orientation** - Locked for optimal viewing
- **Custom app icons** and splash screens

**5. Smooth Visual Effects**
- **Gradient backgrounds** - Beautiful pink/purple/blue gradients
- **Animated progress bar** - Shows completion with smooth transitions
- **Card stacking** - See next cards behind current card
- **Border beams** - Animated border effects on cards
- **Confetti celebration** - When you complete all cards! 🎉
- **Spring animations** - Numbers bounce when they update

### How to Use

**Desktop/Laptop:**
1. Visit `http://localhost:3000/admin/swipe`
2. **Click and drag** cards left/right
3. Or use the **button controls** below the card

**Mobile:**
1. Open `http://localhost:3000/admin/swipe` on your phone
2. **Swipe left** to pass (red X)
3. **Swipe right** to like (green heart)
4. **Tap buttons** if you prefer
5. **Undo** button appears when you can go back

### Installing as PWA (Mobile)

**iOS (Safari):**
1. Open the swipe page in Safari
2. Tap the **Share** button (square with arrow)
3. Scroll and tap **"Add to Home Screen"**
4. Tap **"Add"**
5. Launch from home screen!

**Android (Chrome):**
1. Open the swipe page in Chrome
2. Tap the **menu** (three dots)
3. Tap **"Add to Home screen"**
4. Confirm and tap **"Add"**
5. Launch from home screen!

### Animation Details

- **Card enter**: Cards animate in from behind with opacity fade
- **Card exit**: Cards fly off screen with rotation and scale
- **Indicators**: "LIKE ❤️" and "PASS ✕" appear with rotation and scale
- **Progress bar**: Smoothly fills with gradient animation
- **Counter bounce**: Numbers scale up when they change

### Performance Optimizations

- ✅ Hardware acceleration with `will-change: transform`
- ✅ CSS transforms for smooth 60fps
- ✅ Touch-action manipulation for better scroll performance
- ✅ Optimized re-renders with React.useCallback
- ✅ Prevented pull-to-refresh on mobile
- ✅ Disabled text selection during drag

---

## Listings Display

### Overview

The main listings page at `/admin/listings` shows all scraped properties with filtering, search, and detailed information.

### Features

**1. Search Function**
- Search across multiple fields:
  - Property title
  - Address
  - Agent name
  - Property type
  - District
- Real-time filtering as you type
- Case-insensitive search
- Clear button to reset search

**2. Filters**
- **District Filter**: All Singapore districts (D01-D28)
- **Price Range**: Under $1M, $1M-$3M, $3M-$5M, Above $5M
- **Portal Filter**: PropertyGuru, EdgeProp, or All

**3. Detailed View**
Each listing shows:
- Property title and price
- District badge
- Property type
- Address
- Size (sqft) and price PSF
- Bedrooms and bathrooms
- Agent contact (name, phone, email)
- Viewing timeslots (with proper date formatting)
- Expandable details section

**4. Viewing Timeslots Display**
- Shows actual dates (e.g., "Mon, Jan 13 6pm")
- Converts from structured data stored in database
- Handles both old text format and new structured format
- Singapore timezone context (dates already calculated in SG time)

### Expandable Details

Click the ▼ button to see:
- **Data Completeness**: Visual indicators for populated fields
- **Basic Info**: Full property details
- **Location**: Address and district
- **Property Details**: Size, PSF, beds, baths, tenure, year built
- **Agent Details**: Full agent information
- **Viewing Information**: Status and timeslots with actual dates
- **Dates & Links**: Posted date, scraped date, original URL

---

## Frontend Pages Overview

### Admin Dashboard (`/admin`)
- Quick navigation to all features
- Links to listings, agents, outreach, viewings
- Access to scraper controls

### Listings Page (`/admin/listings`)
- All scraped properties
- Search and filter functionality
- Detailed property information
- Agent contact details

### Agents Page (`/admin/agents`)
- All scraped agents
- Contact information
- Associated listings
- Agency details

### Outreach Page (`/admin/outreach`)
- Outreach campaign tracking
- Message status
- Conversation phases
- Co-broking status

### Viewings Page (`/admin/viewings`)
- Calendar view of all viewing timeslots
- Multiple visualization modes
- Swipe interface for mobile
- Detailed viewing information

### Scraper Dashboard (`/admin/scraper`)
- Control web scrapers
- Monitor scraping progress
- View scraping history
- Data quality metrics

---

## Display Logic & Filtering

### Viewing Status

Listings are displayed based on `viewing_status`:
- **`received`**: Timeslots confirmed ✅ (shown in calendar)
- **`requested`**: Request sent, waiting for reply
- **`pending`**: Initial state
- **`failed`**: No timeslots received after graceful exit

**Important:** Only listings with `viewing_status = 'received'` show in calendar view.

### Database Fields

**Listings Table:**
- `viewing_timeslots` (TEXT): Human-readable formatted text
- `viewing_timeslots_structured` (JSONB): Structured data for parsing
- `viewing_status` (TEXT): Status of viewing request
- `viewing_requested_at` (TIMESTAMPTZ): When request was sent

### Structured Data Format

```json
{
  "available": true,
  "slots": [
    {
      "day": "Monday",
      "date": "2025-01-13",
      "time": "6pm",
      "formatted": "Monday, Jan 13 6pm"
    }
  ],
  "notes": null
}
```

---

## Responsive Design

All pages are fully responsive:
- **Mobile**: Optimized touch targets, simplified layouts
- **Tablet**: Medium layouts with side panels
- **Desktop**: Full-featured layouts with multiple columns

**Breakpoints:**
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

---

**All UI features are production-ready and fully functional! 🎨**

