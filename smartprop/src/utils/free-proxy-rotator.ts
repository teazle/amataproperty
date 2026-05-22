/**
 * Free Proxy Rotator
 *
 * WARNING: Free proxies are unreliable, slow, and often blocked by Cloudflare.
 * They may also be insecure. Use at your own risk.
 *
 * For better results, consider paid residential proxy services.
 */

interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

/**
 * Fetch free proxies from public lists
 * Note: These are datacenter proxies, not residential
 */
export async function fetchFreeProxies(): Promise<ProxyConfig[]> {
  const proxies: ProxyConfig[] = [];

  try {
    // ProxyScrape free proxy API (HTTP proxies)
    const response = await fetch('https://api.proxyscrape.com/v2/?request=get&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all');
    const text = await response.text();

    // Parse proxy list (format: ip:port\nip:port...)
    const lines = text.trim().split('\n').filter(line => line.includes(':'));

    for (const line of lines.slice(0, 20)) { // Limit to 20 proxies
      const [host, port] = line.trim().split(':');
      if (host && port) {
        proxies.push({
          server: `http://${host}:${port}`,
        });
      }
    }

    console.log(`✅ Fetched ${proxies.length} free proxies from ProxyScrape`);
  } catch (error) {
    console.log(`⚠️  Failed to fetch free proxies: ${error instanceof Error ? error.message : String(error)}`);
  }

  return proxies;
}

/**
 * Test if a proxy is working
 */
export async function testProxy(proxy: ProxyConfig, timeout: number = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const testUrl = 'https://httpbin.org/ip';
    const response = await fetch(testUrl, {
      signal: controller.signal,
      // Note: Browser fetch doesn't support proxy directly
      // This is just a placeholder - actual proxy testing needs to be done in Playwright
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Get a random proxy from the list
 */
export function getRandomProxy(proxies: ProxyConfig[]): ProxyConfig | null {
  if (proxies.length === 0) return null;
  return proxies[Math.floor(Math.random() * proxies.length)];
}

/**
 * Get proxy from environment variable
 * Format: PROXY_URL=http://user:pass@host:port or PROXY_URL=http://host:port
 */
export function getProxyFromEnv(): ProxyConfig | null {
  const proxyUrl = process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;

  if (!proxyUrl) return null;

  try {
    const url = new URL(proxyUrl);
    const config: ProxyConfig = {
      server: `${url.protocol}//${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`,
    };

    if (url.username || url.password) {
      config.username = url.username || undefined;
      config.password = url.password || undefined;
    }

    return config;
  } catch (error) {
    console.log(`⚠️  Invalid proxy URL format: ${proxyUrl}`);
    return null;
  }
}
