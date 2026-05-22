# Free Proxy Setup for PropertyGuru Authentication

## ⚠️ Important Warnings

1. **Free proxies are unreliable** - They often go offline, are slow, and get blocked quickly
2. **Not residential** - Most free services only offer datacenter proxies, which Cloudflare easily detects
3. **Security risk** - Free proxies may log your traffic or be compromised
4. **Limited bandwidth** - Free proxies have strict bandwidth limits
5. **May not work** - Cloudflare often blocks datacenter proxies immediately

## Free Proxy Options

### Option 1: ProxyScrape (Free Datacenter Proxies)
- **URL**: https://proxyscrape.com/free-proxy-list
- **Type**: Datacenter (HTTP, SOCKS4, SOCKS5)
- **Limits**: Updated every minute, thousands of proxies
- **Cost**: Free
- **Note**: These are datacenter proxies, not residential

### Option 2: Webshare (Free Tier)
- **URL**: https://www.webshare.io/
- **Type**: Datacenter proxies
- **Free Tier**: 10 proxies, 1GB/month bandwidth
- **Cost**: Free (with registration)
- **Note**: Requires account registration

### Option 3: Free Proxy Lists
- **ProxyScrape API**: `https://api.proxyscrape.com/v2/?request=get&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all`
- **GitHub Lists**: Various GitHub repos with free proxy lists
- **Note**: These are often unreliable and slow

## How to Use

### Method 1: Environment Variable (Recommended)

Set the `PROXY_URL` environment variable:

```bash
# Format: http://username:password@host:port
export PROXY_URL="http://user:pass@proxy.example.com:8080"

# Or without authentication
export PROXY_URL="http://proxy.example.com:8080"

# For HTTPS proxy
export PROXY_URL="https://proxy.example.com:8080"
```

Then run the authentication:
```bash
bun src/workers/auth.pg.ts
```

### Method 2: Direct Configuration

Edit `smartprop/src/workers/auth.pg.ts` and modify the proxy configuration section.

## Testing a Proxy

Before using a proxy, test if it works:

```bash
# Test proxy connectivity
curl -x http://proxy.example.com:8080 https://httpbin.org/ip

# Test with authentication
curl -x http://user:pass@proxy.example.com:8080 https://httpbin.org/ip
```

## Why Free Proxies May Not Work

1. **Cloudflare Detection**: Cloudflare has extensive IP reputation databases and blocks known datacenter proxy IPs
2. **TLS Fingerprinting**: Datacenter proxies often have different TLS signatures that Cloudflare detects
3. **IP Reputation**: Free proxy IPs are often already flagged by Cloudflare
4. **Speed**: Free proxies are slow, causing timeouts

## Better Alternatives

### Paid Residential Proxies (Recommended)
- **Bright Data** (formerly Luminati): $500/month for residential proxies
- **Smartproxy**: $75/month for residential proxies
- **Oxylabs**: $300/month for residential proxies
- **IPRoyal**: $1.39 per proxy for 90 days (cheapest option)

### Free Trials
Some services offer free trials:
- **Smartproxy**: 3-day free trial
- **Bright Data**: Free trial available
- **Oxylabs**: Free trial available

## Current Implementation

The authentication script now supports proxy configuration via:
- `PROXY_URL` environment variable
- `HTTP_PROXY` environment variable
- `HTTPS_PROXY` environment variable

The proxy will be automatically used when launching the browser.

## Example Usage

```bash
# Set proxy
export PROXY_URL="http://proxy.example.com:8080"

# Run authentication
cd /opt/smartprop/app/smartprop
bun src/workers/auth.pg.ts
```

## Troubleshooting

If proxy doesn't work:
1. Check proxy is accessible: `curl -x http://proxy:port https://httpbin.org/ip`
2. Verify credentials are correct
3. Check if proxy supports HTTPS
4. Try a different proxy (free proxies are unreliable)
5. Consider using a paid residential proxy service

## Recommendation

For PropertyGuru's aggressive Cloudflare protection, **free datacenter proxies will likely not work**. Consider:
1. **Manual authentication** on your local machine (best free option)
2. **Paid residential proxies** (most reliable)
3. **Free trial** of a residential proxy service
