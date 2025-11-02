'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, MapPin, DollarSign, Phone, Building2, Heart, X, RotateCcw, Home } from 'lucide-react';
import { DotPattern } from '@/components/ui/dot-pattern';
import { BorderBeam } from '@/components/ui/border-beam';
import { Confetti, ConfettiRef } from '@/components/ui/confetti';
import { cn } from '@/lib/utils';

interface ViewingSlot {
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

export default function SwipePage() {
  const [slots, setSlots] = useState<ViewingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [likedSlots, setLikedSlots] = useState<string[]>([]);
  const [passedSlots, setPassedSlots] = useState<string[]>([]);
  const confettiRef = useRef<ConfettiRef>(null);

  // Haptic feedback for mobile
  const triggerHaptic = useCallback((style: 'light' | 'medium' | 'heavy' = 'medium') => {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      const patterns = { light: 10, medium: 20, heavy: 30 };
      navigator.vibrate(patterns[style]);
    }
  }, []);

  useEffect(() => {
    fetchViewings();
    // Prevent pull-to-refresh on mobile
    document.body.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overscrollBehavior = 'auto';
    };
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
      // Filter to only upcoming slots
      const upcoming = parsedSlots.filter((s: ViewingSlot) => s.start > new Date());
      setSlots(upcoming);
    } catch (error) {
      console.error('Failed to fetch viewings:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleSwipe = useCallback((direction: 'left' | 'right') => {
    const currentSlot = slots[currentIndex];
    
    // Haptic feedback
    triggerHaptic(direction === 'right' ? 'medium' : 'light');
    
    if (direction === 'right') {
      setLikedSlots(prev => [...prev, currentSlot.id]);
    } else {
      setPassedSlots(prev => [...prev, currentSlot.id]);
    }
    
    // Check if this was the last card
    if (currentIndex + 1 >= slots.length) {
      // Fire confetti when completing all cards
      triggerHaptic('heavy');
      setTimeout(() => {
        confettiRef.current?.fire({
          particleCount: 150,
          spread: 90,
          origin: { y: 0.6 },
          ticks: 300
        });
      }, 300);
    }
    
    setCurrentIndex(currentIndex + 1);
  }, [currentIndex, slots, triggerHaptic]);

  const handleUndo = useCallback(() => {
    if (currentIndex > 0) {
      triggerHaptic('light');
      const previousSlot = slots[currentIndex - 1];
      setLikedSlots(prev => prev.filter(id => id !== previousSlot.id));
      setPassedSlots(prev => prev.filter(id => id !== previousSlot.id));
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex, slots, triggerHaptic]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh] bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <div className="text-center">
          <motion.div
            className="relative mx-auto mb-6 w-20 h-20"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          >
            <Heart className="h-20 w-20 text-pink-500" />
          </motion.div>
          <motion.p 
            className="text-gray-700 font-medium text-lg"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            Loading viewings...
          </motion.p>
        </div>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 relative flex flex-col">
        <DotPattern className="opacity-20" />
        
        {/* Mobile Header */}
        <div className="safe-top p-4 relative z-10">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.location.href = '/admin/viewings'}
            className="rounded-full"
          >
            <Home className="h-5 w-5 mr-2" />
            Back
          </Button>
        </div>

        <div className="flex-1 flex items-center justify-center p-6 relative z-10">
          <motion.div 
            className="text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <motion.div
              animate={{ 
                scale: [1, 1.1, 1],
                rotate: [0, -10, 10, 0]
              }}
              transition={{ 
                duration: 2,
                repeat: Infinity,
                repeatDelay: 1
              }}
            >
              <Heart className="h-24 w-24 mx-auto mb-6 text-gray-300" />
            </motion.div>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">No Viewings Available</h2>
            <p className="text-gray-600 mb-8 max-w-sm mx-auto">There are no upcoming viewing slots to review right now</p>
            <Button 
              onClick={() => window.location.href = '/admin/viewings'}
              size="lg"
              className="rounded-full px-8 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600"
            >
              <Calendar className="h-5 w-5 mr-2" />
              View Calendar
            </Button>
          </motion.div>
        </div>
      </div>
    );
  }

  if (currentIndex >= slots.length) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 relative overflow-hidden flex flex-col">
        <DotPattern className="opacity-20" />
        <Confetti ref={confettiRef} className="absolute inset-0 z-50 pointer-events-none" />
        
        {/* Mobile Header */}
        <div className="safe-top p-4 relative z-10">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.location.href = '/admin/viewings'}
            className="rounded-full"
          >
            <Home className="h-5 w-5 mr-2" />
            Back
          </Button>
        </div>
        
        <div className="flex-1 flex items-center justify-center p-6 relative z-10">
          <motion.div
            className="w-full max-w-md"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
          >
            <Card className="p-8 text-center relative overflow-hidden bg-white/80 backdrop-blur-sm border-2 border-white shadow-2xl">
              <BorderBeam size={250} duration={12} delay={9} />
              
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
              >
                <Heart className="h-20 w-20 mx-auto mb-4 text-pink-500 fill-pink-500" />
              </motion.div>
              
              <motion.h3 
                className="text-3xl md:text-4xl font-bold text-gray-900 mb-2"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                All Done! 🎉
              </motion.h3>
              <motion.p 
                className="text-gray-600 text-base md:text-lg mb-8"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                You&apos;ve reviewed all available viewing slots
              </motion.p>
              
              <div className="grid grid-cols-2 gap-4 mb-8">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="p-5 bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border-2 border-green-200"
                >
                  <Heart className="h-10 w-10 text-green-600 mx-auto mb-2 fill-green-600" />
                  <p className="text-xs font-semibold text-green-900 mb-1">Liked Viewings</p>
                  <p className="text-4xl font-bold text-green-600">{likedSlots.length}</p>
                </motion.div>
                
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="p-5 bg-gradient-to-br from-gray-50 to-slate-50 rounded-2xl border-2 border-gray-200"
                >
                  <X className="h-10 w-10 text-gray-600 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-gray-900 mb-1">Passed</p>
                  <p className="text-4xl font-bold text-gray-600">{passedSlots.length}</p>
                </motion.div>
              </div>

              <motion.div 
                className="flex flex-col sm:flex-row gap-3 justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
              >
                <Button 
                  onClick={() => {
                    triggerHaptic('medium');
                    setCurrentIndex(0);
                    setLikedSlots([]);
                    setPassedSlots([]);
                  }} 
                  size="lg"
                  className="bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 rounded-full px-8 font-semibold"
                >
                  <RotateCcw className="h-5 w-5 mr-2" />
                  Start Over
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => window.location.href = '/admin/viewings'}
                  size="lg"
                  className="rounded-full px-8 font-semibold border-2"
                >
                  <Calendar className="h-5 w-5 mr-2" />
                  Calendar
                </Button>
              </motion.div>
            </Card>
          </motion.div>
        </div>
      </div>
    );
  }

  const currentSlot = slots[currentIndex];

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 relative flex flex-col touch-none select-none">
      {/* Subtle Background Pattern */}
      <DotPattern className="opacity-20" />
      
      {/* Mobile Header */}
      <div className="safe-top px-4 pt-4 pb-2 relative z-10 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.location.href = '/admin/viewings'}
          className="rounded-full"
        >
          <Home className="h-5 w-5 mr-2" />
          Back
        </Button>
        
        <div className="flex gap-3 text-sm font-bold">
          <motion.span 
            className="flex items-center gap-1 text-green-600"
            key={`liked-${likedSlots.length}`}
            initial={{ scale: 1.5 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 15 }}
          >
            ❤️ {likedSlots.length}
          </motion.span>
          <motion.span 
            className="flex items-center gap-1 text-red-600"
            key={`passed-${passedSlots.length}`}
            initial={{ scale: 1.5 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 15 }}
          >
            ✕ {passedSlots.length}
          </motion.span>
        </div>
      </div>
      
      <div className="flex-1 flex flex-col px-4 pb-4 relative z-10">
        {/* Progress Section */}
        <div className="w-full max-w-md mx-auto mb-4">
          <div className="flex items-center justify-between mb-2">
            <motion.span 
              className="text-sm font-bold text-gray-900"
              key={`progress-${currentIndex}`}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              {currentIndex + 1} / {slots.length}
            </motion.span>
            <span className="text-xs text-gray-600 font-medium">
              Swipe or tap buttons
            </span>
          </div>
          <div className="w-full bg-white/60 backdrop-blur-sm rounded-full h-2.5 overflow-hidden shadow-inner">
            <motion.div 
              className="bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 h-2.5 rounded-full shadow-lg"
              initial={{ width: 0 }}
              animate={{ width: `${((currentIndex + 1) / slots.length) * 100}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Card Area - Optimized for mobile */}
        <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto min-h-0">
          <div className="relative w-full h-full max-h-[calc(100dvh-220px)] min-h-[500px]">
            {/* Stack of cards behind */}
            <AnimatePresence>
              {currentIndex + 2 < slots.length && (
                <motion.div 
                  key={`stack-2-${slots[currentIndex + 2].id}`}
                  className="absolute inset-0 flex items-center justify-center"
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 0.85, opacity: 0.15 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                >
                  <Card className="w-full h-full bg-white shadow-xl transform -rotate-3 border-2 border-gray-200" />
                </motion.div>
              )}
              {currentIndex + 1 < slots.length && (
                <motion.div 
                  key={`stack-1-${slots[currentIndex + 1].id}`}
                  className="absolute inset-0 flex items-center justify-center"
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 0.93, opacity: 0.3 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                >
                  <Card className="w-full h-full bg-white shadow-xl transform rotate-2 border-2 border-gray-300" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Current card */}
            <div className="absolute inset-0 flex items-center justify-center">
              <SwipeCard
                slot={currentSlot}
                onSwipe={handleSwipe}
                key={currentSlot.id}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-center gap-4 sm:gap-6 mt-4 w-full flex-shrink-0">
            <motion.div 
              whileHover={{ scale: 1.1 }} 
              whileTap={{ scale: 0.85 }}
              className="touch-manipulation"
            >
              <Button
                variant="outline"
                size="lg"
                onClick={() => handleSwipe('left')}
                className="rounded-full w-14 h-14 sm:w-16 sm:h-16 p-0 border-4 border-red-400 hover:bg-red-50 hover:border-red-500 shadow-xl bg-white active:shadow-inner transition-all"
              >
                <X className="h-7 w-7 sm:h-8 sm:w-8 text-red-500" strokeWidth={3} />
              </Button>
            </motion.div>

            {currentIndex > 0 && (
              <motion.div 
                whileHover={{ scale: 1.05 }} 
                whileTap={{ scale: 0.9 }}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0 }}
                className="touch-manipulation"
              >
                <Button
                  variant="outline"
                  onClick={handleUndo}
                  className="rounded-full px-3 py-1.5 sm:px-4 sm:py-2 text-sm font-semibold bg-white text-gray-700 border-2 shadow-lg hover:shadow-xl transition-all"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Undo
                </Button>
              </motion.div>
            )}

            <motion.div 
              whileHover={{ scale: 1.1 }} 
              whileTap={{ scale: 0.85 }}
              className="touch-manipulation"
            >
              <Button
                variant="outline"
                size="lg"
                onClick={() => handleSwipe('right')}
                className="rounded-full w-14 h-14 sm:w-16 sm:h-16 p-0 border-4 border-green-400 hover:bg-green-50 hover:border-green-500 shadow-xl bg-white active:shadow-inner transition-all"
              >
                <Heart className="h-7 w-7 sm:h-8 sm:w-8 text-green-500 fill-green-500" strokeWidth={3} />
              </Button>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Individual Swipe Card Component
function SwipeCard({ slot, onSwipe }: { slot: ViewingSlot; onSwipe: (direction: 'left' | 'right') => void }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-30, 30]);
  const opacity = useTransform(x, [-300, -150, 0, 150, 300], [0.5, 1, 1, 1, 0.5]);
  const [exitX, setExitX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnd = (_: unknown, info: { offset: { x: number; y: number }; velocity: { x: number; y: number } }) => {
    setIsDragging(false);
    const threshold = 120; // Swipe threshold
    
    if (Math.abs(info.offset.x) > threshold) {
      // Haptic feedback on mobile
      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(info.offset.x > 0 ? 20 : 15);
      }
      
      // Animate card off screen with spring physics
      setExitX(info.offset.x > 0 ? 1000 : -1000);
      
      // Delay the state update to allow smooth animation
      setTimeout(() => {
        onSwipe(info.offset.x > 0 ? 'right' : 'left');
      }, 250);
    }
  };

  return (
    <motion.div
      className={cn(
        "w-full h-full touch-manipulation",
        isDragging ? "cursor-grabbing" : "cursor-grab"
      )}
      style={{ 
        x, 
        y,
        rotate,
        opacity,
        willChange: "transform"
      }}
      animate={{ 
        x: exitX, 
        opacity: exitX !== 0 ? 0 : 1,
        scale: exitX !== 0 ? 0.8 : 1
      }}
      transition={{ 
        type: "spring", 
        stiffness: 400, 
        damping: 30,
        mass: 0.8
      }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={handleDragEnd}
      whileTap={{ scale: 1.02, cursor: "grabbing" }}
    >
      <Card className="shadow-2xl border-0 bg-white hover:shadow-3xl transition-shadow relative overflow-hidden h-full w-full">
        <BorderBeam size={200} duration={8} delay={0} colorFrom="#ff00aa" colorTo="#00FFF1" />
        
        {/* Swipe Indicators - Larger and more visible on mobile */}
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-green-500 text-white px-8 sm:px-12 py-4 sm:py-6 rounded-2xl font-bold text-2xl sm:text-4xl shadow-2xl z-20 border-4 border-white pointer-events-none"
          style={{ 
            opacity: useTransform(x, [40, 150], [0, 1]),
            scale: useTransform(x, [40, 150], [0.7, 1.2]),
            rotate: useTransform(x, [40, 150], [-20, 0])
          }}
        >
          LIKE ❤️
        </motion.div>
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-500 text-white px-8 sm:px-12 py-4 sm:py-6 rounded-2xl font-bold text-2xl sm:text-4xl shadow-2xl z-20 border-4 border-white pointer-events-none"
          style={{ 
            opacity: useTransform(x, [-150, -40], [1, 0]),
            scale: useTransform(x, [-150, -40], [1.2, 0.7]),
            rotate: useTransform(x, [-150, -40], [0, 20])
          }}
        >
          PASS ✕
        </motion.div>
        
        {/* Gradient overlays when swiping */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-br from-green-400/30 to-green-600/30 z-10 pointer-events-none"
          style={{ opacity: useTransform(x, [40, 180], [0, 0.6]) }}
        />
        <motion.div
          className="absolute inset-0 bg-gradient-to-br from-red-400/30 to-red-600/30 z-10 pointer-events-none"
          style={{ opacity: useTransform(x, [-180, -40], [0.6, 0]) }}
        />

        <div className="p-4 sm:p-5 space-y-2 sm:space-y-2.5 h-full flex flex-col">
          {/* Property Title & District */}
          <div className="flex-shrink-0">
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-base sm:text-lg font-bold text-gray-900 flex-1 pr-2 leading-tight line-clamp-2">
                {slot.listingTitle}
              </h2>
              {slot.district && (
                <Badge className="text-xs shrink-0 bg-blue-600 text-white px-2 py-0.5 font-bold whitespace-nowrap">
                  {slot.district}
                </Badge>
              )}
            </div>
            {slot.address && (
              <p className="text-gray-700 flex items-center gap-1 text-[11px] line-clamp-1">
                <MapPin className="h-3 w-3 text-blue-500 flex-shrink-0" />
                <span className="font-medium truncate">{slot.address}</span>
              </p>
            )}
          </div>

          {/* Property Image Placeholder */}
          <div className="bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 rounded-lg h-20 sm:h-24 flex items-center justify-center relative overflow-hidden border border-gray-200 flex-shrink-0">
            <div className="absolute inset-0 bg-gradient-to-br from-transparent via-white/30 to-transparent" />
            <Building2 className="h-10 sm:h-12 w-10 sm:w-12 text-blue-400 relative z-10" strokeWidth={1.5} />
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-2 flex-shrink-0">
            {/* Date & Time */}
            <div className="p-2 sm:p-2.5 bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg border border-purple-200">
              <div className="flex items-center gap-1 text-purple-700 mb-0.5">
                <Calendar className="h-3 w-3" />
                <span className="text-[9px] sm:text-[10px] font-bold uppercase">Time</span>
              </div>
              <div className="space-y-0.5">
                <p className="font-bold text-gray-900 text-[11px] sm:text-xs">
                  {slot.start.toLocaleDateString('en-SG', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
                <p className="text-[10px] sm:text-[11px] text-gray-700 font-semibold leading-tight">
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

            {/* Price */}
            {slot.price && (
              <div className="p-2 sm:p-2.5 bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-1 text-green-700 mb-0.5">
                  <DollarSign className="h-3 w-3" />
                  <span className="text-[9px] sm:text-[10px] font-bold uppercase">Price</span>
                </div>
                <p className="text-base sm:text-lg font-bold text-green-700 leading-tight">
                  ${(slot.price / 1000).toFixed(0)}K
                </p>
                <p className="text-[10px] sm:text-[11px] text-green-600 font-medium">
                  ${slot.price.toLocaleString()}
                </p>
              </div>
            )}
          </div>

          {/* Agent Info */}
          <div className="p-2 sm:p-2.5 bg-gradient-to-br from-orange-50 to-amber-50 rounded-lg border border-orange-200 flex-shrink-0">
            <div className="flex items-center gap-1 text-orange-700 mb-0.5">
              <Phone className="h-3 w-3" />
              <span className="text-[9px] sm:text-[10px] font-bold uppercase">Agent</span>
            </div>
            <p className="font-bold text-gray-900 text-xs sm:text-sm truncate">{slot.agentName}</p>
            <p className="text-[11px] text-gray-700 font-semibold">{slot.agentPhone}</p>
          </div>

          {/* Status Badge */}
          <div className="flex items-center justify-center flex-shrink-0 pt-1">
            <Badge className="bg-green-100 text-green-800 border border-green-300 px-3 py-0.5 text-[10px] sm:text-xs font-bold">
              ✓ {slot.status.toUpperCase()}
            </Badge>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
