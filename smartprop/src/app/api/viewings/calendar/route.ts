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
          // Has specific date - parse in Singapore timezone to avoid UTC conversion issues
          startDate = parseDateInSingaporeTimezone(date as string);
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
            // Extract date components from the date string to avoid timezone conversion issues
            let year: number, month: number, day: number;
            
            if (date) {
              // Parse from the original date string
              const dateMatch = (date as string).match(/^(\d{4})-(\d{2})-(\d{2})/);
              if (dateMatch) {
                year = parseInt(dateMatch[1]);
                month = parseInt(dateMatch[2]) - 1; // JavaScript months are 0-indexed
                day = parseInt(dateMatch[3]);
              } else {
                // Fallback to date object methods
                year = startDate.getFullYear();
                month = startDate.getMonth();
                day = startDate.getDate();
              }
            } else {
              // Fallback to date object methods if no date string
              year = startDate.getFullYear();
              month = startDate.getMonth();
              day = startDate.getDate();
            }
            
            // Create new date objects with explicit Singapore timezone for the times
            const startTimeStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(timeInfo.start.hour).padStart(2, '0')}:${String(timeInfo.start.minute).padStart(2, '0')}:00+08:00`;
            startDate = new Date(startTimeStr);
            
            if (timeInfo.end) {
              const endTimeStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(timeInfo.end.hour).padStart(2, '0')}:${String(timeInfo.end.minute).padStart(2, '0')}:00+08:00`;
              endDate = new Date(endTimeStr);
            } else {
              // Default 1 hour slot
              const endHour = timeInfo.start.hour + 1;
              const endTimeStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(endHour).padStart(2, '0')}:${String(timeInfo.start.minute).padStart(2, '0')}:00+08:00`;
              endDate = new Date(endTimeStr);
            }
          } else {
            // Default time if can't parse - use Singapore timezone
            const dateMatch = (date as string)?.match(/^(\d{4})-(\d{2})-(\d{2})/);
            let year: number, month: number, day: number;
            
            if (dateMatch) {
              year = parseInt(dateMatch[1]);
              month = parseInt(dateMatch[2]) - 1;
              day = parseInt(dateMatch[3]);
            } else {
              year = startDate.getFullYear();
              month = startDate.getMonth();
              day = startDate.getDate();
            }
            
            const startTimeStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T14:00:00+08:00`;
            const endTimeStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T15:00:00+08:00`;
            startDate = new Date(startTimeStr);
            endDate = new Date(endTimeStr);
          }
        } else {
          // No time specified - default to 2-3pm in Singapore timezone
          const dateMatch = (date as string)?.match(/^(\d{4})-(\d{2})-(\d{2})/);
          let year: number, month: number, day: number;
          
          if (dateMatch) {
            year = parseInt(dateMatch[1]);
            month = parseInt(dateMatch[2]) - 1;
            day = parseInt(dateMatch[3]);
          } else {
            year = startDate.getFullYear();
            month = startDate.getMonth();
            day = startDate.getDate();
          }
          
          const startTimeStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T14:00:00+08:00`;
          const endTimeStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T15:00:00+08:00`;
          startDate = new Date(startTimeStr);
          endDate = new Date(endTimeStr);
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

// Helper: Parse ISO date string (YYYY-MM-DD) in Singapore timezone
// This avoids timezone conversion issues when parsing date-only strings
function parseDateInSingaporeTimezone(dateStr: string): Date {
  // Parse ISO date string (YYYY-MM-DD)
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    // Fallback to standard Date parsing if format doesn't match
    return new Date(dateStr);
  }
  
  const [, year, month, day] = match;
  
  // Create date string with explicit Singapore timezone (UTC+8)
  // Format: YYYY-MM-DDTHH:mm:ss+08:00
  // We use midnight Singapore time to avoid any timezone conversion issues
  const singaporeDateStr = `${year}-${month}-${day}T00:00:00+08:00`;
  const date = new Date(singaporeDateStr);
  
  return date;
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

