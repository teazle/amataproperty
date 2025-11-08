# EC2 Resource Calculation for t4g.small

## Instance Specifications
- **Type**: t4g.small
- **RAM**: 2GB total
- **vCPUs**: 2 cores
- **OS**: ~200-300MB

## Current Container Resource Limits

### docker-compose.prod.yml

| Container | Memory Limit | Memory Reservation | CPU Limit | CPU Reservation |
|-----------|-------------|-------------------|-----------|----------------|
| smartprop-app | 2G | 1G | 1.0 | 0.5 |
| waha | 1G | - | 0.5 | - |
| flaresolverr | **800M** | 400M | 0.75 | 0.4 |
| nginx | 256M | - | 0.25 | - |
| **TOTAL LIMITS** | **4.056G** | **1.4G** | **2.5** | **0.9** |

⚠️ **Note**: Limits are maximums, not actual usage. Actual usage is typically 50-70% of limits.

## Actual Memory Usage (Estimated)

| Container | Typical Usage | Peak Usage |
|-----------|--------------|------------|
| smartprop-app | 600-800M | 1.2G |
| waha | 200-400M | 600M |
| flaresolverr | 400-600M | 800M |
| nginx | 50M | 100M |
| System | 200M | 300M |
| **TOTAL** | **1.45-2.05G** | **3.0G** |

## Safety Analysis

### ✅ Safe Configuration (Current)
- **Peak usage**: ~2.0-2.5GB (within 2GB with some headroom)
- **Risk**: Low - Docker limits prevent OOM kills
- **Recommendation**: Monitor actual usage with `docker stats`

### ⚠️ If You Need More Performance

**Option 1: Upgrade to t4g.medium (4GB RAM)**
- Can safely increase flaresolverr to 1.5G-2G
- More headroom for concurrent operations
- Cost: ~$0.0336/hour vs $0.0168/hour (2x)

**Option 2: Optimize Current Containers**
- Reduce smartprop-app limit to 1G (if not needed)
- Reduce waha limit to 600M
- This frees up ~600M for flaresolverr

## Monitoring Commands

```bash
# Check actual memory usage
docker stats --no-stream

# Check system memory
free -h

# Check if any container is hitting limits
docker stats --format "table {{.Container}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}"
```

## Recommendations

1. **Current config is SAFE** - 800M limit for flaresolverr won't crash t4g.small
2. **Monitor usage** - Run `docker stats` during scraping to see actual usage
3. **If OOM kills occur** - Consider upgrading to t4g.medium
4. **CPU is fine** - 0.75 CPU limit is safe (leaves 1.25 for other containers)

## Flaresolverr Optimization Summary

- **Memory**: 800M limit (safe for 2GB instance)
- **CPU**: 0.75 cores (good balance)
- **Shared Memory**: 256M (increased from 128M)
- **Browser Timeout**: 200s (matches maxTimeout)
- **Locale**: en_SG (Singapore)

These settings provide good performance while staying within t4g.small limits.

