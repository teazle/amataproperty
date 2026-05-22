"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { BorderBeam } from "@/components/ui/border-beam";
import { useEffect, useRef, useState } from "react";

export default function Home() {
  const buttonRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [frameWidth, setFrameWidth] = useState<number>(0);
  useEffect(() => {
    const videoAspectRatio = 1.335187;
    const compute = () => {
      const section = sectionRef.current;
      if (!section) return;
      const width = section.clientWidth;
      const height = section.clientHeight;
      const maxWidth = 1620;
      // Allow media frame to be 135% of viewport width (like huly.io) up to maxWidth
      // This allows it to exceed viewport dimensions (centered overflow)
      const targetWidth = Math.min(width * 1.35, maxWidth);
      setFrameWidth(targetWidth);
    };
    compute();
    const onResize = () => compute();
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(() => compute());
    if (sectionRef.current) ro.observe(sectionRef.current);
    return () => { window.removeEventListener('resize', onResize); ro.disconnect(); };
  }, []);
  // No dynamic overlay positioning needed when using a centered, max-width media frame

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

  // No dynamic overlay positioning needed when using a centered, max-width media frame

  return (
    <div className="landing-page min-h-screen bg-background font-sans antialiased">
      {/* Navigation */}
      <header className="fixed left-0 top-0 z-50 w-full px-4 animate-fade-in border-b opacity-0 backdrop-blur-[12px] [--animation-delay:600ms]">
        <div className="container mx-auto flex h-[var(--navigation-height)] w-full items-center justify-between">
          <Link className="text-md flex items-center justify-center hero-header-link" href="/">
            ViewProperty.ai
          </Link>
          <div className="ml-auto flex h-full items-center">
            <Link href="/admin">
              <Button variant="ghost" size="sm" className="text-sm text-white">
                Admin
              </Button>
            </Link>
            <Link href="/admin">
              <Button size="sm" className="ml-4 text-sm">
                Open System
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section ref={sectionRef} className="relative min-h-[100svh] overflow-hidden bg-black pt-0 px-safe">
          {/* Centered media frame (adds black side gutters on ultrawide) */}
          <div className="absolute inset-0 z-0 overflow-visible">
            <div className="absolute left-1/2 -translate-x-1/2" data-media-frame style={{ width: frameWidth, aspectRatio: '1.335187', top: '-20%' }}>
              <video
                autoPlay
                loop
                muted
                playsInline
                className="absolute inset-0 h-full w-full object-contain"
              >
                <source src="/hero.mp4" type="video/mp4" />
              </video>

              {/* Overlay image positioned by ratios within the frame */}
              <div className="absolute bottom-0 left-[18.4%] w-[53.21%]">
                <div className="relative rounded-lg overflow-hidden shadow-2xl bg-black/30 backdrop-blur-md border border-transparent w-full" style={{ aspectRatio: '862 / 600' }}>
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
          
          {/* Title + CTA positioned relative to viewport, not media frame */}
          <div className="absolute z-20 top-[20%] left-0 w-full px-8 pointer-events-auto">
            <h1 className="hero-title text-white text-5xl md:text-6xl lg:text-7xl xl:text-[72px] font-semibold tracking-tight leading-[0.9]">ViewProperty.ai</h1>
            <p className="mt-5 max-w-xl text-base md:text-lg text-white/80">
              Property intelligence, lead matching, and outreach automation for Singapore agents.
            </p>
            <div style={{ marginTop: '30px' }}>
              <Link 
                href="/admin"
                className="cta"
                ref={(el) => { if (el) buttonRefs.current[0] = el; }}
              >
                <div className="glow-container">
                  <div className="glow-layer-1"></div>
                  <div className="glow-layer-2"></div>
                </div>
                <span className="label">Admin Login</span>
              </Link>
            </div>
          </div>
          
          {/* Content band removed; content is inside the media frame */}

          {/* overlay moved into media wrapper above */}
        </section>

      </main>

      {/* Footer */}
      <footer className="bg-black text-white py-8">
        <div className="container mx-auto px-4">
          <div className="text-center text-sm">
            <p>Copyright © 2026 ViewProperty.ai. All Rights Reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
