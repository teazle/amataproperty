'use client';

import { useState, useEffect } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { ViewingCalendar, ViewingSlot } from '@/components/viewing-calendar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, MapPin, DollarSign, Phone, Building2, LayoutGrid, List, Clock, Heart, X } from 'lucide-react';
import { ShineBorder } from '@/components/ui/shine-border';

type ViewMode = 'calendar' | 'list' | 'timeline' | 'grid' | 'swipe';

export default function ViewingsPage() {
  const [slots, setSlots] = useState<ViewingSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<ViewingSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [stats, setStats] = useState({ total: 0, today: 0, thisWeek: 0, unique: 0 });

  useEffect(() => {
    fetchViewings();
  }, []);

  async function fetchViewings() {
    try {
      const res = await fetch('/api/viewings/calendar');
      const data = await res.json();
      const parsedSlots = data.events.map((e: unknown) => {
        const event = e as Record<string, unknown>;
        return {
          ...event,
          start: new Date(event.start as string),
          end: new Date(event.end as string),
        };
      });
      setSlots(parsedSlots);
      
      // Calculate stats
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      
      const todayCount = parsedSlots.filter((s: ViewingSlot) => 
        s.start >= startOfDay && s.start < new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)
      ).length;
      
      const weekCount = parsedSlots.filter((s: ViewingSlot) => s.start >= startOfWeek).length;
      const uniqueProperties = new Set(parsedSlots.map((s: ViewingSlot) => s.listingId)).size;
      
      setStats({
        total: parsedSlots.length,
        today: todayCount,
        thisWeek: weekCount,
        unique: uniqueProperties,
      });
    } catch (error) {
      console.error('Failed to fetch viewings:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading viewing schedule...</p>
        </div>
      </div>
    );
  }

  const upcomingSlots = slots
    .filter(s => s.start > new Date())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Viewing Schedule
          </h1>
          <p className="text-gray-600 mt-2">
            Manage all your property viewing timeslots in one place
          </p>
        </div>
        
        {/* View Mode Toggles */}
        <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
          <Button
            variant={viewMode === 'calendar' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('calendar')}
            className={`gap-2 ${viewMode === 'calendar' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-gray-700 hover:text-gray-900'}`}
          >
            <Calendar className="h-4 w-4" />
            Calendar
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
            className={`gap-2 ${viewMode === 'list' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-gray-700 hover:text-gray-900'}`}
          >
            <List className="h-4 w-4" />
            List
          </Button>
          <Button
            variant={viewMode === 'timeline' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('timeline')}
            className={`gap-2 ${viewMode === 'timeline' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-gray-700 hover:text-gray-900'}`}
          >
            <Clock className="h-4 w-4" />
            Timeline
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('grid')}
            className={`gap-2 ${viewMode === 'grid' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-gray-700 hover:text-gray-900'}`}
          >
            <LayoutGrid className="h-4 w-4" />
            Grid
          </Button>
          <Button
            variant={viewMode === 'swipe' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('swipe')}
            className={`gap-2 ${viewMode === 'swipe' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-gray-700 hover:text-gray-900'}`}
          >
            <Heart className="h-4 w-4" />
            Swipe
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 relative overflow-hidden border-blue-200 bg-gradient-to-br from-blue-50 to-white">
          <ShineBorder shineColor={["#3b82f6", "#8b5cf6"]} borderWidth={2} duration={8} />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Viewings</p>
              <p className="text-3xl font-bold text-blue-600">{stats.total}</p>
            </div>
            <Calendar className="h-10 w-10 text-blue-500 opacity-20" />
          </div>
        </Card>

        <Card className="p-4 relative overflow-hidden border-green-200 bg-gradient-to-br from-green-50 to-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Today</p>
              <p className="text-3xl font-bold text-green-600">{stats.today}</p>
            </div>
            <Calendar className="h-10 w-10 text-green-500 opacity-20" />
          </div>
        </Card>

        <Card className="p-4 relative overflow-hidden border-purple-200 bg-gradient-to-br from-purple-50 to-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">This Week</p>
              <p className="text-3xl font-bold text-purple-600">{stats.thisWeek}</p>
            </div>
            <Calendar className="h-10 w-10 text-purple-500 opacity-20" />
          </div>
        </Card>

        <Card className="p-4 relative overflow-hidden border-orange-200 bg-gradient-to-br from-orange-50 to-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Properties</p>
              <p className="text-3xl font-bold text-orange-600">{stats.unique}</p>
            </div>
            <Building2 className="h-10 w-10 text-orange-500 opacity-20" />
          </div>
        </Card>
      </div>

      {/* Content based on view mode */}
      {viewMode === 'calendar' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <ViewingCalendar 
              slots={slots}
              onSelectSlot={setSelectedSlot}
            />
          </div>
          <div className="lg:col-span-1">
            <SelectedSlotPanel selectedSlot={selectedSlot} upcomingSlots={upcomingSlots} onSelectSlot={setSelectedSlot} />
          </div>
        </div>
      )}

      {viewMode === 'list' && <ListView slots={upcomingSlots} onSelectSlot={setSelectedSlot} />}
      {viewMode === 'timeline' && <TimelineView slots={slots} />}
      {viewMode === 'grid' && <GridView slots={upcomingSlots} onSelectSlot={setSelectedSlot} />}
      {viewMode === 'swipe' && <SwipeView slots={upcomingSlots} />}
    </div>
  );
}

// Selected Slot Panel Component
function SelectedSlotPanel({ selectedSlot, upcomingSlots, onSelectSlot }: { 
  selectedSlot: ViewingSlot | null; 
  upcomingSlots: ViewingSlot[];
  onSelectSlot: (slot: ViewingSlot) => void;
}) {
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 5;
  return (
    <div className="space-y-4">
      {selectedSlot ? (
        <Card className="p-6 space-y-4 bg-white relative overflow-hidden border-2 border-blue-100">
          <ShineBorder shineColor={["#3b82f6", "#8b5cf6"]} borderWidth={2} duration={10} />
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Selected Viewing</h3>
              <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                {selectedSlot.status}
              </Badge>
            </div>
            
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs font-medium text-gray-500 mb-1">Property</p>
                <p className="text-base font-bold text-gray-900">{selectedSlot.listingTitle}</p>
              </div>

              {selectedSlot.address && (
                <div className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                  <MapPin className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-gray-500">Address</p>
                    <p className="text-sm text-gray-900 mt-1">{selectedSlot.address}</p>
                  </div>
                </div>
              )}

              {selectedSlot.price && (
                <div className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                  <DollarSign className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-gray-500">Price</p>
                    <p className="text-sm font-semibold text-gray-900 mt-1">
                      ${selectedSlot.price.toLocaleString()}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                <Calendar className="h-5 w-5 text-purple-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-gray-500">Time</p>
                  <p className="text-sm text-gray-900 mt-1">
                    {selectedSlot.start.toLocaleString('en-SG', {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
                <Phone className="h-5 w-5 text-orange-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-gray-500">Agent</p>
                  <p className="text-sm font-medium text-gray-900 mt-1">{selectedSlot.agentName}</p>
                  <p className="text-sm text-gray-500 mt-1">{selectedSlot.agentPhone}</p>
                </div>
              </div>

              {selectedSlot.district && (
                <div className="pt-3 border-t">
                  <Badge variant="outline" className="text-sm">
                    District {selectedSlot.district}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-6 bg-white relative overflow-hidden">
          <div className="text-center text-gray-500 py-12">
            <Calendar className="h-16 w-16 mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium mb-2">No Viewing Selected</p>
            <p className="text-sm">Click on a viewing slot to see details</p>
          </div>
        </Card>
      )}

      <Card className="p-6 bg-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Upcoming Viewings</h3>
            <p className="text-xs text-gray-500">
              Showing {currentPage * itemsPerPage + 1}-{Math.min((currentPage + 1) * itemsPerPage, upcomingSlots.length)} of {upcomingSlots.length}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
              disabled={currentPage === 0}
              className="text-xs h-7 px-3"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => prev + 1)}
              disabled={currentPage * itemsPerPage + itemsPerPage >= upcomingSlots.length}
              className="text-xs h-7 px-3"
            >
              Next 5
            </Button>
          </div>
        </div>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {upcomingSlots.slice(currentPage * itemsPerPage, (currentPage + 1) * itemsPerPage).map((slot) => (
            <button
              key={slot.id}
              onClick={() => onSelectSlot(slot)}
              className="w-full text-left p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 hover:shadow-sm"
            >
              <div className="flex justify-between items-start mb-2">
                <p className="font-medium text-sm truncate pr-2 text-gray-900">
                  {slot.listingTitle}
                </p>
                {slot.district && (
                  <Badge variant="secondary" className="text-xs shrink-0 bg-gray-100">
                    D{slot.district}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-gray-600 flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {slot.start.toLocaleDateString('en-SG', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })} - {slot.end.toLocaleTimeString('en-SG', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            </button>
          ))}
          
          {upcomingSlots.length === 0 && (
            <div className="text-center py-8">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm text-gray-500">No upcoming viewings scheduled</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// List View Component
function ListView({ slots, onSelectSlot }: { slots: ViewingSlot[]; onSelectSlot: (slot: ViewingSlot) => void }) {
  return (
    <Card className="p-6">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-3 px-4 font-semibold text-gray-900">Property</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-900">Date & Time</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-900">Agent</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-900">Price</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-900">District</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-900">Status</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr 
                key={slot.id}
                onClick={() => onSelectSlot(slot)}
                className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
              >
                <td className="py-4 px-4">
                  <p className="font-medium text-gray-900">{slot.listingTitle}</p>
                  {slot.address && <p className="text-sm text-gray-500 mt-1">{slot.address}</p>}
                </td>
                <td className="py-4 px-4 text-gray-700">
                  <div className="flex flex-col">
                    <span className="font-medium">{slot.start.toLocaleDateString('en-SG', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}</span>
                    <span className="text-sm text-gray-600">
                      {slot.start.toLocaleTimeString('en-SG', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })} - {slot.end.toLocaleTimeString('en-SG', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </td>
                <td className="py-4 px-4">
                  <p className="text-gray-900">{slot.agentName}</p>
                  <p className="text-sm text-gray-500">{slot.agentPhone}</p>
                </td>
                <td className="py-4 px-4 font-semibold text-gray-900">
                  {slot.price ? `$${slot.price.toLocaleString()}` : '-'}
                </td>
                <td className="py-4 px-4">
                  {slot.district && (
                    <Badge variant="secondary" className="bg-gray-200 text-gray-900">D{slot.district}</Badge>
                  )}
                </td>
                <td className="py-4 px-4">
                  <Badge variant="secondary" className="bg-green-100 text-green-700">
                    {slot.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {slots.length === 0 && (
          <div className="text-center py-12">
            <List className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-gray-500">No viewings to display</p>
          </div>
        )}
      </div>
    </Card>
  );
}

// Timeline View Component
function TimelineView({ slots }: { slots: ViewingSlot[] }) {
  const properties = Array.from(new Set(slots.map(s => s.listingTitle)));
  const days = Array.from(new Set(slots.map(s => s.start.toLocaleDateString('en-SG'))));
  
  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4 text-gray-900">Timeline View</h3>
      <div className="overflow-x-auto">
        <div className="min-w-max">
          {/* Header */}
          <div className="flex border-b border-gray-200 pb-3 mb-3">
            <div className="w-64 font-semibold text-gray-900">Property</div>
            {days.map(day => (
              <div key={day} className="w-40 text-center font-semibold text-gray-900">{day}</div>
            ))}
          </div>
          
          {/* Rows */}
          {properties.map(property => (
            <div key={property} className="flex border-b border-gray-100 py-3 hover:bg-gray-50">
              <div className="w-64 font-medium text-gray-900">{property}</div>
              {days.map(day => {
                const daySlots = slots.filter(s => 
                  s.listingTitle === property && 
                  s.start.toLocaleDateString('en-SG') === day
                );
                return (
                  <div key={day} className="w-40 text-center">
                    {daySlots.map(slot => (
                      <Badge key={slot.id} variant="secondary" className="text-xs m-1 bg-blue-100 text-blue-700">
                        {slot.start.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })} - {slot.end.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })}
                      </Badge>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {properties.length === 0 && (
        <div className="text-center py-12">
          <Clock className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p className="text-gray-500">No viewings to display</p>
        </div>
      )}
    </Card>
  );
}

// Grid View Component
function GridView({ slots, onSelectSlot }: { slots: ViewingSlot[]; onSelectSlot: (slot: ViewingSlot) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {slots.map((slot) => (
        <Card 
          key={slot.id}
          className="p-4 hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-blue-300"
          onClick={() => onSelectSlot(slot)}
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">{slot.listingTitle}</h3>
              {slot.district && (
                <Badge variant="secondary" className="text-xs shrink-0 ml-2">D{slot.district}</Badge>
              )}
            </div>
            
            {slot.address && (
              <p className="text-xs text-gray-600 flex items-start gap-1">
                <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
                {slot.address}
              </p>
            )}
            
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Calendar className="h-3 w-3" />
              {slot.start.toLocaleString('en-SG', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })} - {slot.end.toLocaleTimeString('en-SG', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </div>
            
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Phone className="h-3 w-3" />
              {slot.agentName}
            </div>
            
            {slot.price && (
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-900">
                <DollarSign className="h-3 w-3" />
                ${slot.price.toLocaleString()}
              </div>
            )}
            
            <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
              {slot.status}
            </Badge>
          </div>
        </Card>
      ))}
      {slots.length === 0 && (
        <div className="col-span-full text-center py-12">
          <LayoutGrid className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p className="text-gray-500">No viewings to display</p>
        </div>
      )}
    </div>
  );
}

// Swipe View Component - Tinder Style
function SwipeView({ slots }: { slots: ViewingSlot[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [likedSlots, setLikedSlots] = useState<string[]>([]);
  const [passedSlots, setPassedSlots] = useState<string[]>([]);

  const handleSwipe = (direction: 'left' | 'right') => {
    const currentSlot = slots[currentIndex];
    if (direction === 'right') {
      setLikedSlots([...likedSlots, currentSlot.id]);
    } else {
      setPassedSlots([...passedSlots, currentSlot.id]);
    }
    setCurrentIndex(currentIndex + 1);
  };

  const handleUndo = () => {
    if (currentIndex > 0) {
      const previousSlot = slots[currentIndex - 1];
      setLikedSlots(likedSlots.filter(id => id !== previousSlot.id));
      setPassedSlots(passedSlots.filter(id => id !== previousSlot.id));
      setCurrentIndex(currentIndex - 1);
    }
  };

  if (slots.length === 0) {
    return (
      <div className="text-center py-12">
        <Heart className="h-16 w-16 mx-auto mb-4 opacity-20" />
        <p className="text-gray-500">No viewings to swipe through</p>
      </div>
    );
  }

  if (currentIndex >= slots.length) {
    return (
      <Card className="p-12 text-center">
        <div className="max-w-md mx-auto">
          <Heart className="h-16 w-16 mx-auto mb-4 text-blue-500" />
          <h3 className="text-2xl font-bold text-gray-900 mb-2">All Done!</h3>
          <p className="text-gray-600 mb-6">You&apos;ve reviewed all available viewing slots</p>
          <div className="space-y-4">
            <div className="p-4 bg-green-50 rounded-lg">
              <p className="text-sm font-medium text-green-900">Liked Viewings</p>
              <p className="text-2xl font-bold text-green-600">{likedSlots.length}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium text-gray-900">Passed</p>
              <p className="text-2xl font-bold text-gray-600">{passedSlots.length}</p>
            </div>
          </div>
          <Button onClick={() => setCurrentIndex(0)} className="mt-6">
            Start Over
          </Button>
        </div>
      </Card>
    );
  }

  const currentSlot = slots[currentIndex];

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-600">
            {currentIndex + 1} of {slots.length}
          </span>
          <span className="text-sm text-gray-600">
            {likedSlots.length} liked
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / slots.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Swipe Cards Stack */}
      <div className="relative h-[600px] flex items-center justify-center">
        {/* Next card preview (behind) */}
        {currentIndex + 1 < slots.length && (
          <div className="absolute w-full max-w-lg transform scale-95 opacity-50">
            <Card className="p-6 bg-gray-50">
              <div className="h-[500px]" />
            </Card>
          </div>
        )}

        {/* Current card */}
        <SwipeCard
          slot={currentSlot}
          onSwipe={handleSwipe}
          key={currentSlot.id}
        />
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-center gap-6 mt-6">
        <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
          <Button
            variant="outline"
            size="lg"
            onClick={() => handleSwipe('left')}
            className="rounded-full w-16 h-16 p-0 border-2 border-red-300 hover:bg-red-50 hover:border-red-500"
          >
            <X className="h-8 w-8 text-red-500" />
          </Button>
        </motion.div>

        {currentIndex > 0 && (
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button
              variant="outline"
              size="sm"
              onClick={handleUndo}
              className="rounded-full"
            >
              Undo
            </Button>
          </motion.div>
        )}

        <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
          <Button
            variant="outline"
            size="lg"
            onClick={() => handleSwipe('right')}
            className="rounded-full w-16 h-16 p-0 border-2 border-green-300 hover:bg-green-50 hover:border-green-500"
          >
            <Heart className="h-8 w-8 text-green-500" />
          </Button>
        </motion.div>
      </div>

      {/* Hints */}
      <div className="flex items-center justify-center gap-8 mt-6 text-sm text-gray-500">
        <span>← Swipe left to pass</span>
        <span>Swipe right to like →</span>
      </div>
    </div>
  );
}

// Individual Swipe Card Component
function SwipeCard({ slot, onSwipe }: { slot: ViewingSlot; onSwipe: (direction: 'left' | 'right') => void }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-25, 25]);
  const _opacity = useTransform(x, [-200, -150, 0, 150, 200], [0, 1, 1, 1, 0]);
  const [exitX, setExitX] = useState(0);

  const handleDragEnd = (_: unknown, info: { offset: { x: number; y: number }; velocity: { x: number; y: number } }) => {
    if (Math.abs(info.offset.x) > 150) {
      // Animate card off screen in the direction of the swipe
      setExitX(info.offset.x > 0 ? 1000 : -1000);
      // Delay the state update to allow animation to complete
      setTimeout(() => {
        onSwipe(info.offset.x > 0 ? 'right' : 'left');
      }, 200);
    }
  };

  return (
    <motion.div
      className="absolute w-full max-w-lg cursor-grab active:cursor-grabbing"
      style={{ x, rotate }}
      animate={{ x: exitX }}
      transition={{ duration: 0.2 }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={handleDragEnd}
      whileTap={{ scale: 1.05 }}
    >
      <Card className="p-6 shadow-2xl border-2 bg-white">
        {/* Swipe Indicators */}
        <motion.div
          className="absolute top-6 right-6 bg-green-500 text-white px-4 py-2 rounded-lg font-bold text-lg transform rotate-12"
          style={{ opacity: useTransform(x, [50, 150], [0, 1]) }}
        >
          LIKE
        </motion.div>
        <motion.div
          className="absolute top-6 left-6 bg-red-500 text-white px-4 py-2 rounded-lg font-bold text-lg transform -rotate-12"
          style={{ opacity: useTransform(x, [-150, -50], [1, 0]) }}
        >
          PASS
        </motion.div>

        <div className="space-y-6">
          {/* Property Title */}
          <div>
            <div className="flex items-start justify-between mb-2">
              <h2 className="text-2xl font-bold text-gray-900 flex-1">{slot.listingTitle}</h2>
              {slot.district && (
                <Badge variant="secondary" className="text-sm shrink-0 ml-2 bg-blue-100 text-blue-700">
                  District {slot.district}
                </Badge>
              )}
            </div>
            {slot.address && (
              <p className="text-gray-600 flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {slot.address}
              </p>
            )}
          </div>

          {/* Property Image Placeholder */}
          <div className="bg-gradient-to-br from-blue-100 to-purple-100 rounded-lg h-48 flex items-center justify-center">
            <Building2 className="h-16 w-16 text-blue-300" />
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2 text-gray-600 mb-2">
                <Calendar className="h-4 w-4" />
                <span className="text-xs font-medium">Date & Time</span>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-gray-900">
                  {slot.start.toLocaleDateString('en-SG', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
                <p className="text-sm text-gray-600">
                  {slot.start.toLocaleTimeString('en-SG', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })} - {slot.end.toLocaleTimeString('en-SG', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>

            {slot.price && (
              <div className="p-4 bg-green-50 rounded-lg">
                <div className="flex items-center gap-2 text-green-600 mb-2">
                  <DollarSign className="h-4 w-4" />
                  <span className="text-xs font-medium">Price</span>
                </div>
                <p className="text-xl font-bold text-green-700">
                  ${slot.price.toLocaleString()}
                </p>
              </div>
            )}
          </div>

          {/* Agent Info */}
          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2 text-blue-600 mb-2">
              <Phone className="h-4 w-4" />
              <span className="text-xs font-medium">Agent</span>
            </div>
            <p className="font-semibold text-gray-900">{slot.agentName}</p>
            <p className="text-sm text-gray-600">{slot.agentPhone}</p>
          </div>

          {/* Status Badge */}
          <div className="flex items-center justify-center">
            <Badge variant="secondary" className="bg-green-100 text-green-700 px-4 py-2 text-sm">
              {slot.status}
            </Badge>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
