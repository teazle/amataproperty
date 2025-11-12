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
        <section className="relative w-full overflow-hidden bg-black py-20 md:py-32 lg:py-40">
          {/* Max-width container to center content */}
          <div className="container mx-auto max-w-7xl px-4">
            
            {/* Video + Image Container - Grouped Together */}
            <div className="relative w-full aspect-[1.77] max-w-5xl mx-auto">
              {/* Video Background */}
              <div className="absolute inset-0 z-0">
                <video
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-contain"
                >
                  <source src="/hero.mp4" type="video/mp4" />
                </video>
              </div>

              {/* Content Container - Title and Button Overlaying Video */}
              <div className="absolute top-0 left-0 z-20 p-6 md:p-8 lg:p-12">
                {/* Title */}
                <h1 className="hero-title text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight text-white leading-[0.9] mb-6 md:mb-8">
                  SmartProp
                </h1>

                {/* Button */}
                <div className="flex flex-col sm:flex-row gap-4 items-start">
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

              {/* Hero Image - Positioned to match video black box */}
              <div className="absolute bottom-0 left-[3%] z-10 w-[53%] h-[55%]">
                <div className="relative rounded-lg overflow-hidden shadow-2xl bg-black/30 backdrop-blur-md border border-transparent w-full h-full">
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
                    className="w-full h-full object-contain object-top"
                    priority
                  />
                  
                  {/* Glow effect */}
                  <div className="absolute inset-0 rounded-lg opacity-30 blur-xl bg-gradient-to-br from-primary/20 via-transparent to-primary/20"></div>
                </div>
              </div>
            </div>
          </div>
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