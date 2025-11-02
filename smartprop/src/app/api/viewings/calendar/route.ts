import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';
import { parseViewingTimeslotsWithAI } from '@/lib/ai/groq';

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    // Fetch listings with received viewing timeslots
    const { data: listings, error } = await supabase
      .from('listings')
      .select(`
        id,
        title,
        address,
        district,
        price,
        viewing_timeslots,
        viewing_timeslots_structured,
        viewing_status,
        agents!inner(name, phone)
      `)
      .eq('viewing_status', 'received')
      .not('viewing_timeslots_structured', 'is', null);

    if (error) {
      throw error;
    }

    if (!listings || listings.length === 0) {
      return NextResponse.json({ events: [] });
    }

    // Convert listings to calendar events
    const events = [];

    for (const listing of listings as unknown[]) {
      const listingObj = listing as Record<string, unknown>;
      const structuredSlots = listingObj.viewing_timeslots_structured as Record<string, unknown>;
      
      if (!structuredSlots || !structuredSlots.available || !structuredSlots.slots) {
        continue;
      }

      // Parse each slot into a calendar event
      for (const slot of structuredSlots.slots as unknown[]) {
        const slotObj = slot as Record<string, unknown>;
        const { day, date, time, formatted } = slotObj;
        
        // Try to create a proper date object
        let startDate: Date;
        let endDate: Date;
        
        // Parse the timeslot
        if (date) {
          // Has specific date
          startDate = new Date(date as string);
        } else if (day) {
          // Has day of week - find next occurrence
          startDate = getNextDayOfWeek(day as string);
        } else {
          // Skip if no date info
          continue;
        }

        // Parse time
        if (time) {
          const timeInfo = parseTimeString(time as string);
          if (timeInfo.start) {
            startDate.setHours(timeInfo.start.hour, timeInfo.start.minute);
            endDate = new Date(startDate);
            
            if (timeInfo.end) {
              endDate.setHours(timeInfo.end.hour, timeInfo.end.minute);
            } else {
              // Default 1 hour slot
              endDate.setHours(startDate.getHours() + 1);
            }
          } else {
            // Default time if can't parse
            startDate.setHours(14, 0); // 2pm default
            endDate = new Date(startDate);
            endDate.setHours(15, 0); // 3pm default
          }
        } else {
          // No time specified - default to 2-3pm
          startDate.setHours(14, 0);
          endDate = new Date(startDate);
          endDate.setHours(15, 0);
        }

        events.push({
          id: `${listingObj.id}-${slotObj.formatted || formatted}`,
          listingId: listingObj.id,
          listingTitle: listingObj.title,
          agentName: (listingObj.agents as Record<string, unknown>)?.name || 'Agent',
          agentPhone: (listingObj.agents as Record<string, unknown>)?.phone || '',
          address: listingObj.address,
          start: startDate,
          end: endDate,
          status: 'available',
          district: listingObj.district,
          price: listingObj.price,
        });
      }
    }

    return NextResponse.json({ events });
  } catch (error: any) {
    console.error('Error fetching viewing calendar:', error);
    return NextResponse.json(
      { error: 'Failed to fetch viewing calendar' },
      { status: 500 }
    );
  }
}

// Helper: Get next occurrence of day of week
function getNextDayOfWeek(dayName: string): Date {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDay = days.findIndex(d => dayName.toLowerCase().includes(d));
  
  if (targetDay === -1) {
    // If "today" or "tomorrow"
    if (dayName.toLowerCase().includes('today')) {
      return new Date();
    } else if (dayName.toLowerCase().includes('tomorrow')) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }
    // Default to today
    return new Date();
  }

  const today = new Date();
  const currentDay = today.getDay();
  const daysUntilTarget = (targetDay - currentDay + 7) % 7 || 7;
  
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + daysUntilTarget);
  
  return targetDate;
}

// Helper: Parse time string like "9am", "3:30pm", "9am-5pm", "6pm to 9pm"
function parseTimeString(timeStr: string): {
  start?: { hour: number; minute: number };
  end?: { hour: number; minute: number };
} {
  const result: { start?: { hour: number; minute: number }; end?: { hour: number; minute: number } } = {};
  
  // Check for range with hyphen (9am-5pm) or "to" (6pm to 9pm)
  const rangeMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (rangeMatch) {
    const [, startHour, startMin = '0', startPeriod, endHour, endMin = '0', endPeriod] = rangeMatch;
    result.start = parseTime(startHour, startMin, startPeriod);
    result.end = parseTime(endHour, endMin, endPeriod);
    return result;
  }

  // Single time (9am, 3:30pm)
  const singleMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (singleMatch) {
    const [, hour, min = '0', period] = singleMatch;
    result.start = parseTime(hour, min, period);
    return result;
  }

  // Time of day (morning, afternoon, evening)
  if (/morning/i.test(timeStr)) {
    result.start = { hour: 10, minute: 0 };
    result.end = { hour: 12, minute: 0 };
  } else if (/afternoon/i.test(timeStr)) {
    result.start = { hour: 14, minute: 0 };
    result.end = { hour: 17, minute: 0 };
  } else if (/evening/i.test(timeStr)) {
    result.start = { hour: 18, minute: 0 };
    result.end = { hour: 20, minute: 0 };
  }

  return result;
}

function parseTime(hour: string, min: string, period: string): { hour: number; minute: number } {
  let h = parseInt(hour);
  const m = parseInt(min);
  
  if (period.toLowerCase() === 'pm' && h !== 12) {
    h += 12;
  } else if (period.toLowerCase() === 'am' && h === 12) {
    h = 0;
  }
  
  return { hour: h, minute: m };
}

