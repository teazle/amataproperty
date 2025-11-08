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
  useSession: boolean = false // Default to false - Flaresolverr works better without sessions
): Promise<FlaresolverrResult | null> {
  try {
    console.log(`   🔧 Using Flaresolverr to solve Cloudflare challenge...`);
    
    // Skip session creation by default - Flaresolverr creates temporary sessions automatically
    // Sessions can cause Chrome connection issues
    let session = null;
    if (useSession) {
      session = flaresolverrSession || await createFlaresolverrSession();
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
      maxTimeout: 180000, // 180 seconds (3 minutes) for aggressive Cloudflare challenges
      returnOnlyCookies: false,
    };
    
    // Only add session if we have one
    if (session) {
      requestBody.session = session;
    }
    
    // Add timeout to fetch request - match Flaresolverr's maxTimeout (180s) plus buffer
    // PropertyGuru Cloudflare can take 30-180 seconds to solve
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.log(`   ⚠️  Flaresolverr request timed out after 200s. Continuing without Flaresolverr...`);
    }, 200000); // 200 seconds - slightly longer than Flaresolverr's 180s maxTimeout
    
    try {
      const response = await fetch(FLARESOLVERR_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        let errorJson: any = null;
        try {
          errorJson = JSON.parse(errorText);
        } catch {
          // Not JSON, ignore
        }
        
        // If timeout error, log but don't fail completely
        if (errorJson?.message?.includes('Timeout') || 
            errorJson?.message?.includes('timeout') ||
            errorText.includes('timeout') ||
            response.status === 408) {
          console.log(`   ⚠️  Flaresolverr timed out (Cloudflare challenge too aggressive). Continuing without Flaresolverr...`);
          return null; // Return null so scraper continues without Flaresolverr
        }
        
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
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      // Handle AbortError (timeout)
      if (fetchError?.name === 'AbortError' || fetchError?.message?.includes('aborted')) {
        console.log(`   ⚠️  Flaresolverr request aborted (timeout). Continuing without Flaresolverr...`);
        return null;
      }
      
      // Handle network errors
      if (fetchError?.code === 'ECONNREFUSED' || fetchError?.code === 'ETIMEDOUT') {
        console.log(`   ⚠️  Flaresolverr connection error: ${fetchError.message}. Continuing without Flaresolverr...`);
        return null;
      }
      
      console.log(`   ⚠️  Flaresolverr fetch error: ${fetchError?.message || fetchError}`);
      return null;
    }
  } catch (error) {
    console.log(`   ⚠️  Flaresolverr error:`, error);
    return null;
  }
}

/**
 * Apply Flaresolverr cookies and user-agent to Playwright context
 * Preserves login cookies while replacing Cloudflare cookies
 */
export async function applyFlaresolverrToContext(
  context: any,
  flaresolverrResult: FlaresolverrResult,
  defaultDomain?: string // Optional: default domain for cookies (e.g., '.propertyguru.com.sg' or '.edgeprop.sg')
): Promise<void> {
  // Get existing cookies to preserve login session
  const existingCookies = await context.cookies();
  
  // Identify Cloudflare cookie names that should be replaced
  const cloudflareCookieNames = ['__cf_bm', 'cf_clearance', '__cfduid', '__cf_ob_info', '__cf_ob_equ'];
  
  // Identify login/session cookie names that should be preserved
  const loginCookiePatterns = ['session', 'auth', 'token', 'user', 'login', 'access', 'refresh', 'jwt'];
  
  // Filter out Cloudflare cookies but keep login cookies
  const preservedCookies = existingCookies.filter((cookie: any) => {
    const cookieName = cookie.name.toLowerCase();
    // Remove Cloudflare cookies
    if (cloudflareCookieNames.some(cfName => cookieName.includes(cfName.toLowerCase()))) {
      return false;
    }
    // Keep login/session cookies
    if (loginCookiePatterns.some(pattern => cookieName.includes(pattern))) {
      return true;
    }
    // Keep all other cookies (they might be important)
    return true;
  });
  
  // Clear all cookies first
  await context.clearCookies();
  
  // Restore preserved cookies (login session)
  if (preservedCookies.length > 0) {
    await context.addCookies(preservedCookies);
    console.log(`   🔐 Preserved ${preservedCookies.length} login/session cookies`);
  }
  
  // Apply cookies from Flaresolverr (these will overwrite Cloudflare cookies)
  const flaresolverrCookies = flaresolverrResult.cookies.map((cookie: any) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain || defaultDomain || '.propertyguru.com.sg',
    path: cookie.path || '/',
    expires: cookie.expires ? cookie.expires : undefined,
    httpOnly: cookie.httpOnly || false,
    secure: cookie.secure !== false, // Default to true for HTTPS sites
    sameSite: (cookie.sameSite === 'None' || cookie.sameSite === 'Lax' || cookie.sameSite === 'Strict') 
      ? cookie.sameSite as 'None' | 'Lax' | 'Strict'
      : 'Lax' as const,
  }));
  
  await context.addCookies(flaresolverrCookies);
  
  // Update user-agent to match Flaresolverr's browser exactly
  await context.setExtraHTTPHeaders({
    'User-Agent': flaresolverrResult.userAgent || FLARESOLVERR_UA,
  });
  
  console.log(`   ✅ Applied ${flaresolverrCookies.length} cookies from Flaresolverr`);
  console.log(`   ✅ User-Agent matched to Flaresolverr's browser`);
}

