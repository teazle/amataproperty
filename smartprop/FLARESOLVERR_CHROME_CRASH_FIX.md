# Flaresolverr Chrome Session Crash Fix

## Problem
Chrome sessions in Flaresolverr keep crashing with errors:
- "invalid session id: session deleted as the browser has closed the connection"
- "session not created: cannot connect to chrome"
- "Unable to receive message from renderer"

## Root Causes (Based on Research)

1. **ARM64 Architecture Issues**: Flaresolverr has known problems on ARM64 systems
2. **Insufficient Shared Memory**: Chrome needs `/dev/shm` (shared memory) - default 64MB is too small
3. **Memory Limits**: Chrome sessions need more memory than default
4. **Timeout Issues**: PropertyGuru's aggressive Cloudflare needs longer timeouts

## Fixes Applied

### 1. Increased Shared Memory (shm_size)
**Critical Fix**: Chrome crashes without enough `/dev/shm`
```yaml
shm_size: 2gb  # Increased from default 64MB
```

### 2. Increased Memory Limits
```yaml
deploy:
  resources:
    limits:
      memory: 2G  # Increased from 1G
      cpus: '1.5'  # Increased from 1.0
```

### 3. Increased Timeouts
```yaml
environment:
  - MAX_TIMEOUT=300000  # 5 minutes (was 60000)
  - BROWSER_TIMEOUT=300000  # Match MAX_TIMEOUT
```

### 4. Sessionless Mode
Changed auth script to use sessionless mode only (sessions crash too quickly):
```typescript
const useSession = false; // Always use sessionless
```

## Current Configuration

Flaresolverr is now running with:
- **ShmSize**: 2GB (2147483648 bytes) ✅
- **Memory**: 2GB limit
- **CPUs**: 1.5
- **Timeouts**: 300 seconds (5 minutes)

## Docker Run Command (Direct)

If docker-compose doesn't apply shm_size correctly, use direct docker run:
```bash
docker run -d \
  --name flaresolverr \
  --restart unless-stopped \
  --shm-size=2g \
  -e LOG_LEVEL=info \
  -e TZ=Asia/Singapore \
  -e MAX_TIMEOUT=300000 \
  -e BROWSER_TIMEOUT=300000 \
  --network smartprop-network \
  --expose 8191 \
  -m 2g \
  --cpus=1.5 \
  ghcr.io/flaresolverr/flaresolverr:latest
```

## Verification

Check if shm_size is applied:
```bash
docker inspect flaresolverr | grep ShmSize
# Should show: "ShmSize": 2147483648 (2GB)
```

## Known Limitations

1. **ARM64 Issues**: Flaresolverr has fundamental problems on ARM64 - sessions may still crash
2. **PropertyGuru Aggressive Cloudflare**: Even with fixes, PropertyGuru's Cloudflare is extremely aggressive
3. **Flaresolverr Deprecated**: Project is no longer officially maintained

## Alternative Solutions

If Flaresolverr continues to crash:
1. **Use x86_64 EC2 instance** instead of ARM64 (better Flaresolverr support)
2. **Manual authentication** locally, then copy state file to EC2
3. **Residential proxies** with CAPTCHA solving services
4. **Alternative Cloudflare bypass** solutions

## Status

- ✅ **EdgeProp**: Working (state file exists)
- ❌ **PropertyGuru**: Still failing (Cloudflare blocking + Flaresolverr crashes)
