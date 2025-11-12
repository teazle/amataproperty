"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { BorderBeam } from "@/components/ui/border-beam";
import { useEffect, useRef } from "react";

export default function Home() {
  const buttonRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  useEffect(() => {
    const btns = buttonRefs.current.filter(Boolean) as HTMLAnchorElement[];
    const cleanupFunctions: (() => void)[] = [];
    
    btns.forEach((btn) => {
      let raf = 0;
      const glowContainer = btn.querySelector('.glow-container') as HTMLElement;
      
      if (!glowContainer) return;
      
      const update = (e: MouseEvent) => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left;
        // Center the 204px glow container on the cursor position
        // The container starts centered (left: 50% with -102px offset)
        // We need to move it so its center (102px from left edge) aligns with cursor
        const offset = x - 102;
        glowContainer.style.transform = `translateX(${offset}px) translateZ(0px)`;
      };

      const onMove = (e: MouseEvent) => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => update(e));
      };

      const onEnter = (e: MouseEvent) => {
        glowContainer.style.opacity = '1';
        onMove(e);
      };

      const onLeave = () => {
        glowContainer.style.opacity = '0';
      };

      btn.addEventListener('pointerenter', onEnter as any);
      btn.addEventListener('pointermove', onMove as any);
      btn.addEventListener('pointerleave', onLeave);

      cleanupFunctions.push(() => {
        cancelAnimationFrame(raf);
        btn.removeEventListener('pointerenter', onEnter as any);
        btn.removeEventListener('pointermove', onMove as any);
        btn.removeEventListener('pointerleave', onLeave);
      });
    });

    return () => {
      cleanupFunctions.forEach(cleanup => cleanup());
    };
  }, []);

  return (
    <div className="min-h-screen bg-background font-sans antialiased">
      {/* Navigation */}
      <header className="fixed left-0 top-0 z-50 w-full px-4 animate-fade-in border-b opacity-0 backdrop-blur-[12px] [--animation-delay:600ms]">
        <div className="container mx-auto flex h-[var(--navigation-height)] w-full items-center justify-between">
          <Link className="text-md flex items-center justify-center hero-header-link" href="/">
            SmartProp
          </Link>
          <div className="ml-auto flex h-full items-center">
            <Link href="/admin">
              <Button variant="ghost" size="sm" className="text-sm text-white">
                Log in
              </Button>
            </Link>
            <Button size="sm" className="ml-4 text-sm">
              Sign up
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="relative h-[1438px] overflow-hidden bg-background pt-[184px] px-safe lg:h-[1078px] lg:pt-28 md:h-auto md:pt-24 sm:pt-[92px]">
          {/* Full-bleed media wrapper (video + overlay image together) */}
          <div className="absolute inset-0 z-0 overflow-hidden">
            <video
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            >
              <source src="/hero.mp4" type="video/mp4" />
            </video>

            {/* Overlay image positioned relative to the video using percentages for responsiveness */}
            <div className="absolute bottom-0 left-[18.4%] w-[53.2%] z-10">
              <div className="relative rounded-lg overflow-hidden shadow-2xl bg-black/30 backdrop-blur-md border border-transparent w-full">
                <BorderBeam
                  size={100}
                  duration={12}
                  borderWidth={2}
                  colorFrom="#ff00aa"
                  colorTo="#00FFF1"
                  delay={0}
                />
                <Image
                  src="/hero-illustration.7100a376.jpg"
                  alt="Hero Image"
                  width={2048}
                  height={1138}
                  className="w-full h-auto object-contain object-top"
                  priority
                />

                {/* Glow effect */}
                <div className="absolute inset-0 rounded-lg opacity-30 blur-xl bg-gradient-to-br from-primary/20 via-transparent to-primary/20"></div>
              </div>
            </div>
          </div>
          
          {/* Content Container */}
          <div className="container relative flex h-full flex-col px-8 z-10">
            {/* Title */}
            <div className="relative mb-32 z-30">
              <h1 className="hero-title text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold tracking-tight text-white leading-[0.9] max-w-[616px] lg:max-w-[528px] md:max-w-[441px] md:text-5xl sm:max-w-64 sm:text-3xl">
                SmartProp
              </h1>
            </div>

            {/* Button */}
            <div className="flex flex-col sm:flex-row gap-4 items-start mb-12 z-30 relative ml-8">
              <Link 
                href="/admin"
                className="cta"
                ref={(el) => {
                  if (el) buttonRefs.current[0] = el;
                }}
              >
                <div className="glow-container">
                  <div className="glow-layer-1"></div>
                  <div className="glow-layer-2"></div>
                </div>
                <span className="label">Admin Dashboard</span>
              </Link>
            </div>
          </div>

          {/* overlay moved into media wrapper above */}
        </section>

      </main>

      {/* Footer */}
      <footer className="bg-black text-white py-8">
        <div className="container mx-auto px-4">
          <div className="text-center text-sm">
            <p>Copyright © 2025 SmartProp. All Rights Reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}