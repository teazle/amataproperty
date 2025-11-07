/**
 * Flaresolverr Integration Helper
 * 
 * Shared module for integrating Flaresolverr with Playwright scrapers
 * to bypass Cloudflare challenges.
 */

// Flaresolverr API endpoint (running on EC2)
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';
let flaresolverrSession: string | null = null;

// Match Flaresolverr's user-agent exactly for cookie compatibility
// Flaresolverr uses: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36
export const FLARESOLVERR_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

export interface FlaresolverrResult {
  cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'None' | 'Lax' | 'Strict';
  }>;
  userAgent: string;
}

/**
 * Create a Flaresolverr session
 */
export async function createFlaresolverrSession(): Promise<string | null> {
  try {
    const response = await fetch(FLARESOLVERR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cmd: 'sessions.create',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.log(`   ⚠️  Failed to create Flaresolverr session: ${response.status} - ${errorText.substring(0, 200)}`);
      return null;
    }

    const data = await response.json();
    if (data.status === 'ok' && data.session) {
      console.log(`   ✅ Created Flaresolverr session: ${data.session}`);
      return data.session;
    } else if (data.status === 'ok' && !data.session) {
      console.log(`   ℹ️  Session creation response: ${JSON.stringify(data)}`);
      return null; // Will create session on-demand
    }
    return null;
  } catch (error) {
    console.log(`   ⚠️  Error creating Flaresolverr session:`, error);
    return null;
  }
}

/**
 * Solve Cloudflare challenge using Flaresolverr
 */
export async function solveCloudflareWithFlaresolverr(
  url: string, 
  useSession: boolean = true
): Promise<FlaresolverrResult | null> {
  try {
    console.log(`   🔧 Using Flaresolverr to solve Cloudflare challenge...`);
    
    // Use existing session or create new one (or skip session if creation fails)
    let session = flaresolverrSession;
    if (!session && useSession) {
      session = await createFlaresolverrSession();
      if (session) {
        flaresolverrSession = session;
      } else {
        // If session creation fails, continue without session (Flaresolverr will create temporary session)
        console.log(`   ℹ️  Continuing without persistent session (Flaresolverr will use temporary session)`);
      }
    }
    
    const requestBody: any = {
      cmd: 'request.get',
      url: url,
      maxTimeout: 120000,
      returnOnlyCookies: false,
    };
    
    // Only add session if we have one
    if (session) {
      requestBody.session = session;
    }
    
    const response = await fetch(FLARESOLVERR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.log(`   ⚠️  Flaresolverr request failed: ${response.status} - ${errorText.substring(0, 200)}`);
      return null;
    }

    const data = await response.json();
    
    if (data.status === 'ok' && data.solution) {
      const cookies = data.solution.cookies || [];
      const userAgent = data.solution.userAgent || FLARESOLVERR_UA;
      
      console.log(`   ✅ Flaresolverr solved Cloudflare! Got ${cookies.length} cookies`);
      return { cookies, userAgent };
    } else {
      console.log(`   ⚠️  Flaresolverr response error: ${data.message || 'Unknown error'}`);
      return null;
    }
  } catch (error) {
    console.log(`   ⚠️  Flaresolverr error:`, error);
    return null;
  }
}

/**
 * Apply Flaresolverr cookies and user-agent to Playwright context
 */
export async function applyFlaresolverrToContext(
  context: any,
  flaresolverrResult: FlaresolverrResult
): Promise<void> {
  // Clear existing cookies for the domain first
  await context.clearCookies();
  
  // Apply cookies from Flaresolverr
  const cookies = flaresolverrResult.cookies.map((cookie: any) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain || '.propertyguru.com.sg',
    path: cookie.path || '/',
    expires: cookie.expires ? cookie.expires : undefined,
    httpOnly: cookie.httpOnly || false,
    secure: cookie.secure !== false, // Default to true for HTTPS sites
    sameSite: (cookie.sameSite === 'None' || cookie.sameSite === 'Lax' || cookie.sameSite === 'Strict') 
      ? cookie.sameSite as 'None' | 'Lax' | 'Strict'
      : 'Lax' as const,
  }));
  
  await context.addCookies(cookies);
  
  // Update user-agent to match Flaresolverr's browser exactly
  await context.setExtraHTTPHeaders({
    'User-Agent': flaresolverrResult.userAgent || FLARESOLVERR_UA,
  });
  
  console.log(`   ✅ Applied ${cookies.length} cookies from Flaresolverr`);
  console.log(`   ✅ User-Agent matched to Flaresolverr's browser`);
}

