'use client';

import { Calendar, momentLocalizer, View } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { useState, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

const localizer = momentLocalizer(moment);

const PROPERTY_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#06b6d4', // cyan
];

export interface ViewingSlot {
  id: string;
  listingId: string;
  listingTitle: string;
  agentName: string;
  agentPhone: string;
  address?: string;
  start: Date;
  end: Date;
  status: 'available' | 'pending' | 'booked';
  district?: string;
  price?: number;
}

interface ViewingCalendarProps {
  slots: ViewingSlot[];
  onSelectSlot?: (slot: ViewingSlot) => void;
}

export function ViewingCalendar({ slots, onSelectSlot }: ViewingCalendarProps) {
  const [view, setView] = useState<View>('week');
  const [date, setDate] = useState(new Date());

  // Generate consistent color for each property
  const getPropertyColor = useCallback((listingId: string) => {
    let hash = 0;
    for (let i = 0; i < listingId.length; i++) {
      hash = listingId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return PROPERTY_COLORS[Math.abs(hash) % PROPERTY_COLORS.length];
  }, []);

  // Custom event styling
  const eventStyleGetter = useCallback((event: ViewingSlot) => {
    const backgroundColor = getPropertyColor(event.listingId);

    return {
      style: {
        backgroundColor,
        borderRadius: '6px',
        opacity: 0.9,
        color: 'white',
        border: '0px',
        display: 'block',
        fontSize: '13px',
        padding: '4px 8px',
      },
    };
  }, [getPropertyColor]);

  // Custom event component
  const EventComponent = useCallback(({ event }: { event: ViewingSlot }) => {
    return (
      <div className="flex flex-col overflow-hidden">
        <div className="font-semibold truncate text-xs">
          {event.listingTitle}
        </div>
        <div className="text-xs opacity-90 truncate">
          {event.agentName}
        </div>
        {event.district && (
          <div className="text-xs opacity-75">
            D{event.district}
          </div>
        )}
      </div>
    );
  }, []);

  const components = useMemo(() => ({
    event: EventComponent,
  }), [EventComponent]);

  return (
    <div className="h-[1400px] w-full">
      <Card className="p-6 h-full bg-white">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Viewing Schedule</h2>
          <div className="flex gap-2 items-center">
            <span className="text-sm text-gray-600">{slots.length} viewings</span>
            <Badge variant="outline" className="text-gray-700">
              Each property has a unique color
            </Badge>
          </div>
        </div>
        
        <Calendar
          localizer={localizer}
          events={slots}
          startAccessor="start"
          endAccessor="end"
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          eventPropGetter={eventStyleGetter}
          components={components}
          onSelectEvent={onSelectSlot}
          style={{ height: 'calc(100% - 80px)' }}
          views={['month', 'week', 'day', 'agenda']}
          defaultView="week"
          step={60}
          showMultiDayTimes
          timeslots={1}
          className="rounded-lg"
        />
      </Card>
    </div>
  );
}
