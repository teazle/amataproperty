# EC2 Instance Type Recommendation

## 🎯 Recommended: t4g.medium

### Why t4g.medium is Perfect for Your System

| Factor | t4g.small (Current) | t4g.medium (Recommended) | t4g.large |
|--------|---------------------|--------------------------|-----------|
| **RAM** | 2GB | **4GB** ✅ | 8GB |
| **vCPU** | 2 | **2** ✅ | 2 |
| **Cost (now)** | $0 | **$0** ✅ | $0 |
| **Cost (after Dec 31)** | ~$12/month | **~$24/month** ✅ | ~$48/month |
| **Flaresolverr Memory** | 800MB (tight) | **1.5-2GB** ✅ | 2-3GB (overkill) |
| **Stability** | ⚠️ Risk of OOM | **✅ Stable** | ✅ Very stable |
| **Headroom** | ⚠️ Limited | **✅ Good** | ✅ Excellent (overkill) |

## Your System Requirements

### Current Resource Usage

| Service | Memory Limit | Typical Usage | Peak Usage | CPU Limit |
|---------|-------------|--------------|------------|-----------|
| smartprop-app | 2G | 600-800M | 1.2G | 1.0 |
| waha | 1G | 200-400M | 600M | 0.5 |
| flaresolverr | 800M | 400-600M | 800M | 0.75 |
| nginx | 256M | 50M | 100M | 0.25 |
| **TOTAL** | **4.056G** | **1.45-2.05G** | **3.0G** | **2.5** |

### Workload Characteristics

1. **Flaresolverr (Cloudflare Bypass)**
   - **Memory-intensive**: Chrome + Cloudflare challenges need RAM
   - **Current**: 800MB limit (tight, may cause OOM)
   - **With t4g.medium**: Can safely use 1.5-2GB
   - **Impact**: ⭐⭐⭐⭐⭐ (Critical - biggest bottleneck)

2. **Property Scraping**
   - **Long-running**: Can run for hours
   - **Memory-intensive**: Multiple browser instances
   - **Current**: Works but tight
   - **With t4g.medium**: Much more headroom
   - **Impact**: ⭐⭐⭐⭐ (High)

3. **Article Scraping**
   - **Long-running**: Can scrape 1000+ articles
   - **Memory-intensive**: Browser + content processing
   - **Current**: Works but tight
   - **With t4g.medium**: More comfortable
   - **Impact**: ⭐⭐⭐ (Medium)

4. **WAHA (WhatsApp)**
   - **Moderate**: Chrome instance for WhatsApp Web
   - **Current**: Fine
   - **With t4g.medium**: Same (no change needed)
   - **Impact**: ⭐⭐ (Low)

5. **Next.js App**
   - **Moderate**: Web server + API
   - **Current**: Fine
   - **With t4g.medium**: Same (no change needed)
   - **Impact**: ⭐⭐ (Low)

## Why NOT t4g.large?

- **8GB RAM**: Overkill for your needs
- **Same CPU**: No benefit (you're not CPU-bound)
- **2x Cost**: ~$48/month after free tier (not worth it)
- **Waste**: You'd never use 8GB

## Why NOT Stay on t4g.small?

- **Tight Memory**: 2GB is cutting it close
- **OOM Risk**: Flaresolverr may hit limits during heavy Cloudflare challenges
- **Limited Growth**: Can't scale up if needed
- **Stress**: Need to carefully manage resource limits

## After Upgrading to t4g.medium

### Updated docker-compose.prod.yml

```yaml
flaresolverr:
  deploy:
    resources:
      limits:
        memory: 1.5G  # Increased from 800M (safe for 4GB instance)
        cpus: '1.0'   # Increased from 0.75 (faster solving)
      reservations:
        memory: 600M  # Increased from 400M
        cpus: '0.5'   # Increased from 0.4
```

### Benefits

1. **Faster Cloudflare Solving**: More memory = faster JavaScript execution
2. **No OOM Kills**: Plenty of headroom
3. **Concurrent Operations**: Can run multiple scrapers simultaneously
4. **Future-Proof**: Room to grow if needed

## Cost Analysis

### Current (t4g.small)
- **Now**: $0 (free trial)
- **After Dec 31, 2025**: ~$12.26/month
- **Annual**: ~$147/year

### Recommended (t4g.medium)
- **Now**: $0 (free trial)
- **After Dec 31, 2025**: ~$24.52/month
- **Annual**: ~$294/year
- **Additional Cost**: ~$12/month (~$147/year)

### Is It Worth It?

**YES** - For production stability:
- **$12/month** = ~$0.40/day
- **Prevents OOM kills** = No downtime = Priceless
- **Faster scraping** = More efficient = Saves time
- **Peace of mind** = Less stress = Better sleep 😴

## Action Plan

1. ✅ **Upgrade NOW** (while free until Dec 31, 2025)
2. ✅ **Update docker-compose.prod.yml** (increase Flaresolverr limits)
3. ✅ **Monitor usage** (verify it's working well)
4. ✅ **Decide after Dec 31** (downgrade if needed, but unlikely)

## Summary

**Recommendation**: **t4g.medium** (4GB RAM, 2 vCPU)

- ✅ **Perfect balance**: Enough memory without waste
- ✅ **Free until Dec 31, 2025**: No cost now
- ✅ **Reasonable cost**: ~$24/month after (worth it for stability)
- ✅ **Future-proof**: Room to grow
- ✅ **Stable**: No OOM kills, faster performance

**Don't upgrade to t4g.large** - it's overkill and 2x the cost for no benefit.

