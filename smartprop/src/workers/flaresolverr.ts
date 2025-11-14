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
    // Add timeout to prevent hanging (30 seconds should be enough for session creation)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.log(`   ⚠️  Flaresolverr session creation timed out after 30s. Continuing without session...`);
    }, 30000); // 30 seconds timeout for session creation
    
    try {
      const response = await fetch(FLARESOLVERR_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cmd: 'sessions.create',
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

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
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      // Handle AbortError (timeout)
      if (fetchError?.name === 'AbortError' || fetchError?.message?.includes('aborted')) {
        console.log(`   ⚠️  Flaresolverr session creation aborted (timeout). Continuing without session...`);
        return null;
      }
      
      // Handle network errors
      if (fetchError?.code === 'ECONNREFUSED' || fetchError?.code === 'ETIMEDOUT') {
        console.log(`   ⚠️  Flaresolverr connection error: ${fetchError.message}. Is Flaresolverr running?`);
        return null;
      }
      
      throw fetchError; // Re-throw other errors
    }
  } catch (error) {
    console.log(`   ⚠️  Error creating Flaresolverr session:`, error);
    return null;
  }
}

/**
 * Solve Cloudflare challenge using Flaresolverr
 * @param url - The URL to solve Cloudflare for
 * @param useSession - Whether to use a persistent session (recommended for multiple requests)
 * @param sessionId - Optional session ID to use (if provided, will use this session instead of creating new one)
 */
export async function solveCloudflareWithFlaresolverr(
  url: string, 
  useSession: boolean = false, // Default to false for backward compatibility
  sessionId?: string // Optional: pass existing session ID
): Promise<FlaresolverrResult | null> {
  try {
    console.log(`   🔧 Using Flaresolverr to solve Cloudflare challenge...`);
    
    // Use provided session ID, or create/get session if useSession is true
    let session = sessionId || null;
    if (useSession && !session) {
      session = flaresolverrSession || await createFlaresolverrSession();
      if (session) {
        flaresolverrSession = session;
        console.log(`   🔗 Using Flaresolverr session: ${session}`);
      } else {
        // If session creation fails, continue without session (Flaresolverr will create temporary session)
        console.log(`   ℹ️  Continuing without persistent session (Flaresolverr will use temporary session)`);
      }
    } else if (session) {
      console.log(`   🔗 Using provided Flaresolverr session: ${session}`);
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
  // Wait a moment to ensure storageState cookies are loaded if context was just created
  await new Promise(resolve => setTimeout(resolve, 100));
  const existingCookies = await context.cookies();
  
  // Log cookie count for debugging
  if (existingCookies.length > 0) {
    console.log(`   📊 Found ${existingCookies.length} existing cookies in context`);
  }
  
  // Identify Cloudflare cookie names that should be replaced
  const cloudflareCookieNames = ['__cf_bm', 'cf_clearance', '__cfduid', '__cf_ob_info', '__cf_ob_equ'];
  
  // Identify login/session cookie names that should be preserved
  // PropertyGuru uses: pgutid, Visitor, and other site-specific cookies
  // EdgeProp uses: SSESS*, PSESSID, EP_*, FBRLHL_*
  const loginCookiePatterns = [
    'session', 'auth', 'token', 'user', 'login', 'access', 'refresh', 'jwt',
    'pgutid', 'visitor', 'propertyguru', // PropertyGuru-specific
    'ssess', 'psessid', 'ep_', 'fbrlhl', 'edgeprop' // EdgeProp-specific
  ];
  
  // Filter out Cloudflare cookies but keep login cookies
  const preservedCookies = existingCookies.filter((cookie: any) => {
    const cookieName = cookie.name.toLowerCase();
    // Remove Cloudflare cookies
    if (cloudflareCookieNames.some(cfName => cookieName.includes(cfName.toLowerCase()))) {
      return false;
    }
    // Keep login/session cookies (including PropertyGuru and EdgeProp specific)
    if (loginCookiePatterns.some(pattern => cookieName.includes(pattern))) {
      return true;
    }
    // Keep all other cookies that are NOT Cloudflare (they might be important for authentication)
    // This includes analytics cookies, but better safe than sorry
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
  // IMPORTANT: Preserve original domain from Flaresolverr - don't override unless missing
  // Some cookies might be domain-specific (www.propertyguru.com.sg vs .propertyguru.com.sg)
  const flaresolverrCookies = flaresolverrResult.cookies.map((cookie: any) => {
    // Use original domain if present, otherwise use default
    let domain = cookie.domain;
    if (!domain) {
      domain = defaultDomain || '.propertyguru.com.sg';
    } else {
      // Normalize domain - ensure it starts with . for subdomain matching
      if (!domain.startsWith('.') && !domain.startsWith('www.')) {
        domain = '.' + domain;
      }
    }
    
    return {
      name: cookie.name,
      value: cookie.value,
      domain: domain,
      path: cookie.path || '/',
      expires: cookie.expires ? cookie.expires : undefined,
      httpOnly: cookie.httpOnly || false,
      secure: cookie.secure !== false, // Default to true for HTTPS sites
      sameSite: (cookie.sameSite === 'None' || cookie.sameSite === 'Lax' || cookie.sameSite === 'Strict') 
        ? cookie.sameSite as 'None' | 'Lax' | 'Strict'
        : 'Lax' as const,
    };
  });
  
  try {
    await context.addCookies(flaresolverrCookies);
    // Silent success - since we're calling Flaresolverr on every listing, verbose logging is too noisy
  } catch (cookieError: any) {
    console.log(`   ⚠️  Error applying some cookies: ${cookieError.message}`);
    // Try applying cookies one by one to see which ones fail
    let successCount = 0;
    for (const cookie of flaresolverrCookies) {
      try {
        await context.addCookies([cookie]);
        successCount++;
      } catch (err: any) {
        console.log(`      ❌ Failed to apply ${cookie.name}: ${err.message}`);
      }
    }
    console.log(`   ✅ Applied ${successCount}/${flaresolverrCookies.length} cookies`);
  }
  
  // NOTE: User-Agent is already set in context creation (FLARESOLVERR_UA)
  // Don't override via setExtraHTTPHeaders as it may conflict with playwright-ghost stealth plugins
  // The context was created with FLARESOLVERR_UA, so it's already matching Flaresolverr's browser
  
  // Only verify and log if Cloudflare cookies are missing (this is important to know)
  const verifyCookies = await context.cookies();
  const cfCookies = verifyCookies.filter((c: any) => 
    ['__cf_bm', 'cf_clearance', '__cfduid'].some(cfName => c.name.toLowerCase().includes(cfName.toLowerCase()))
  );
  
  // Only log warning if Cloudflare cookies are missing (this is important to know)
  if (cfCookies.length === 0) {
    console.log(`   ⚠️  Warning: No Cloudflare cookies found after applying!`);
  }
}

/**
 * Check if Cloudflare cookies are expired or about to expire
 * Returns true if cookies need refresh (expired or expiring within 5 minutes)
 */
export async function shouldRefreshCloudflareCookies(context: any): Promise<boolean> {
  try {
    const cookies = await context.cookies();
    const cloudflareCookieNames = ['__cf_bm', 'cf_clearance', '__cfduid'];
    
    // Check if we have any Cloudflare cookies
    const cfCookies = cookies.filter((cookie: any) => 
      cloudflareCookieNames.some(cfName => cookie.name.toLowerCase().includes(cfName.toLowerCase()))
    );
    
    if (cfCookies.length === 0) {
      // No Cloudflare cookies - need to get them
      return true;
    }
    
    // Check if any Cloudflare cookie is expired or expiring soon (within 5 minutes)
    const now = Date.now() / 1000; // Current time in seconds
    const refreshThreshold = 5 * 60; // 5 minutes in seconds
    
    for (const cookie of cfCookies) {
      if (!cookie.expires || cookie.expires === -1) {
        // Session cookie (no expiration) - assume it's valid
        continue;
      }
      
      const timeUntilExpiry = cookie.expires - now;
      
      if (timeUntilExpiry <= 0) {
        // Cookie expired
        console.log(`   ⏰ Cloudflare cookie ${cookie.name} expired (expired ${Math.abs(timeUntilExpiry)}s ago)`);
        return true;
      }
      
      if (timeUntilExpiry <= refreshThreshold) {
        // Cookie expiring soon
        console.log(`   ⏰ Cloudflare cookie ${cookie.name} expiring soon (${Math.floor(timeUntilExpiry / 60)}m remaining)`);
        return true;
      }
    }
    
    // All cookies are valid
    return false;
  } catch (error) {
    console.log(`   ⚠️  Error checking cookie expiration: ${error}`);
    // If we can't check, assume we need refresh (better safe than sorry)
    return true;
  }
}

