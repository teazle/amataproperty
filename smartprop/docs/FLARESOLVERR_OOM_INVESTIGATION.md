# Flaresolverr Chrome Crash Investigation

## 🔍 Root Cause Identified

**Problem**: Flaresolverr's Chrome browser was being killed by Linux OOM (Out Of Memory) killer.

## 📊 Evidence

### System Logs Show OOM Kill
```
oom-kill:constraint=CONSTRAINT_MEMCG
Memory cgroup out of memory: Killed process 233142 (chromium)
total-vm:1459464876kB, anon-rss:82712kB, file-rss:19924kB
```

### Container Configuration
- **Memory Limit**: 500MB (524288000 bytes)
- **Memory Swap**: 1GB (1048576000 bytes)
- **Shared Memory**: 64MB (67108864 bytes)
- **Current Usage**: ~250MB (50% of limit)

### What Happened

1. **Multiple Chrome Processes**: Flaresolverr spawns multiple Chrome processes to solve Cloudflare challenges
2. **Memory Pressure**: When solving PropertyGuru Cloudflare challenges, Chrome processes consumed more memory
3. **OOM Killer Activated**: When Chrome exceeded the 500MB limit, Linux OOM killer terminated the process
4. **Connection Errors**: This caused "cannot connect to chrome at 127.0.0.1" errors

### Timeline

1. **22:16:00** - Flaresolverr timeout (180s) - Chrome was likely struggling with memory
2. **22:23:07** - Multiple Chrome connection errors - Chrome processes were killed
3. **22:27:23** - Flaresolverr restarted (after container restart)
4. **22:28:00** - Flaresolverr working again (fresh start, no memory pressure)

## 🎯 Root Causes

### Primary Issue: Insufficient Memory Limit
- **Current**: 500MB limit
- **Problem**: Chrome + Flaresolverr + Cloudflare challenge solving needs more memory
- **Impact**: Chrome processes get killed when memory usage spikes

### Contributing Factors

1. **Multiple Concurrent Requests**: When scraper makes multiple Flaresolverr calls, multiple Chrome instances spawn
2. **Cloudflare Challenge Complexity**: PropertyGuru's Cloudflare challenges are resource-intensive
3. **Shared Memory**: 64MB shared memory may be insufficient for Chrome's multi-process architecture
4. **No Memory Headroom**: 500MB limit leaves no buffer for memory spikes

## 🔧 Solution

### Increase Memory Limits

**Recommended Configuration:**
```yaml
deploy:
  resources:
    limits:
      memory: 1G      # Increase from 500M to 1G
      cpus: '0.5'
    reservations:
      memory: 512M    # Increase from 300M to 512M
      cpus: '0.25'
```

**Also increase shared memory:**
```yaml
shm_size: 128M  # Increase from 64M to 128M
```

### Why This Works

1. **More Headroom**: 1GB gives Chrome enough memory for Cloudflare challenges
2. **Multiple Processes**: Can handle multiple Chrome instances without OOM kills
3. **Stability**: Reduces likelihood of Chrome crashes during heavy usage

## 📈 Current System Resources

- **Total Memory**: 1.8GB
- **Available**: 1.2GB
- **Flaresolverr Usage**: ~250MB (50% of 500MB limit)
- **System Load**: High (load average: 2.20, 11.74, 10.88)

## ⚠️ Considerations

### EC2 Instance Type
- **Current**: t4g.small (2GB RAM)
- **Impact**: Limited total memory available
- **Recommendation**: Consider t4g.medium (4GB RAM) if memory issues persist

### Alternative Solutions

1. **Reduce Concurrent Requests**: Limit number of simultaneous Flaresolverr calls
2. **Increase Timeout**: Give Chrome more time to solve challenges (reduces memory pressure)
3. **Session Reuse**: Reuse Chrome sessions instead of creating new ones
4. **Memory Monitoring**: Add alerts when memory usage exceeds 80%

## ✅ Verification

After applying fix:
1. Monitor Flaresolverr memory usage: `docker stats flaresolverr`
2. Check system logs: `sudo dmesg | grep -i oom`
3. Test with PropertyGuru URLs: Verify Chrome doesn't crash
4. Monitor for 24 hours: Ensure stability

## 📝 Notes

- Flaresolverr was restarted manually, which temporarily fixed the issue
- The problem will recur under load without increasing memory limits
- Chrome memory usage varies based on Cloudflare challenge complexity
- PropertyGuru's Cloudflare is more aggressive than other sites

