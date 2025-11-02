"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { BorderBeam } from "@/components/ui/border-beam";
import { Particles } from "@/components/ui/particles";

export default function Home() {
  return (
    <div className="min-h-screen bg-background font-sans antialiased">
      {/* Navigation */}
      <header className="fixed left-0 top-0 z-50 w-full px-4 animate-fade-in border-b opacity-0 backdrop-blur-[12px] [--animation-delay:600ms]">
        <div className="container mx-auto flex h-[var(--navigation-height)] w-full items-center justify-between">
          <Link className="text-md flex items-center justify-center" href="/">
            SmartProp
          </Link>
          <div className="ml-auto flex h-full items-center">
            <Link href="/admin">
              <Button variant="ghost" size="sm" className="text-sm">
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
        <section className="relative flex flex-col items-center justify-center px-4 py-32 text-center">
          {/* Particle Background */}
          <div className="absolute inset-0">
            <Particles
              className="absolute inset-0"
              quantity={100}
              ease={80}
              color="#ffffff"
              size={0.5}
              vx={0}
              vy={0}
            />
          </div>
          
          <div className="container mx-auto max-w-5xl relative z-10">

            <div className="relative mb-6">
              <h1 className="text-5xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
                SmartProp
              </h1>
              {/* Glow effect behind title */}
              <div className="absolute inset-0 blur-3xl opacity-30">
                <h1 className="text-5xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
                  SmartProp
                </h1>
              </div>
            </div>


            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
              <Link href="/admin">
                <ShimmerButton
                  className="bg-white text-black px-8 py-3 text-lg font-medium rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_8px_rgba(0,0,0,0.05),0_12px_24px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_4px_rgba(0,0,0,0.08),0_8px_16px_rgba(0,0,0,0.06),0_16px_32px_rgba(0,0,0,0.05)]"
                  shimmerColor="#ffffff"
                  shimmerSize="0.05em"
                  shimmerDuration="3s"
                  borderRadius="8px"
                  background="rgba(255, 255, 255, 1)"
                >
                  Admin Dashboard
                </ShimmerButton>
              </Link>
            </div>

            {/* Hero Image */}
            <div className="relative mx-auto max-w-4xl">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl">
                <BorderBeam
                  size={100}
                  duration={12}
                  borderWidth={2}
                  colorFrom="#ff00aa"
                  colorTo="#00FFF1"
                  delay={0}
                />
                <Image
                  src="/hero-dark.png"
                  alt="Hero Image"
                  width={800}
                  height={560}
                  className="w-full h-auto"
                  priority
                />
                
                {/* Glow effect */}
                <div className="absolute inset-0 rounded-2xl opacity-40 blur-xl bg-gradient-to-br from-primary/20 via-transparent to-primary/20"></div>
              </div>
            </div>
          </div>
        </section>

        {/* Trusted By Section */}
        <section className="py-16">
          <div className="container mx-auto text-center">
            <p className="text-sm text-muted-foreground mb-8 uppercase tracking-wide">
              TRUSTED BY TEAMS FROM AROUND THE WORLD
            </p>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t py-16">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <h3 className="font-semibold text-foreground mb-4">SmartProp</h3>
              <p className="text-sm text-muted-foreground">
                UI Library for Design Engineers
              </p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">Email Collection</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-4">Community</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">Discord</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Twitter</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Email</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">Terms</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Privacy</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t mt-12 pt-8 text-center text-sm text-muted-foreground">
            <p>Copyright © 2025 SmartProp. All Rights Reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}