# Deploy Flaresolverr Optimization to EC2

## Changes Deployed
- ✅ Flaresolverr called once per district (search page)
- ✅ Cookies reused for all listing pages  
- ✅ Flaresolverr only called again if Cloudflare blocks detected
- ✅ Cookies saved after Flaresolverr solves Cloudflare

## Deployment Steps

### 1. SSH to EC2
```bash
ssh -i /Users/vincent/propertydemo/smartprop-new-key.pem -o StrictHostKeyChecking=no ec2-user@52.76.114.103
```

### 2. Pull Latest Code
```bash
cd /opt/smartprop/app
git pull origin main
cd smartprop
```

### 3. Install Dependencies (if needed)
```bash
bun install --frozen-lockfile
```

### 4. Test with Console Logs Visible
```bash
# Set environment variables
export PG_DISTRICTS="09"  # Test with one district
export PG_MAX_PAGES="1"   # Test with 1 page
export PG_MIN_PRICE="1000000"
export PG_MAX_PRICE="3000000"
export HEADLESS="false"   # Show browser for debugging

# Run scraper with visible console logs
bun run scrape:pg:districts
```

### 5. Monitor Console Output
Watch for these log messages:
- `💾 Saved fresh Cloudflare cookies to storage state (search page)` - After search page Flaresolverr
- `🛡️  Cloudflare detected - calling Flaresolverr to solve...` - Only if Cloudflare blocks
- `💾 Saved fresh Cloudflare cookies to storage state` - After listing page Flaresolverr (if needed)
- `✅ Saved: [Agent Name] - [Phone]` - Successful scraping

### 6. Expected Behavior
- **First listing**: Should load with cookies from search page (no Flaresolverr call)
- **If Cloudflare blocks**: Should see "Cloudflare detected - calling Flaresolverr"
- **After Flaresolverr**: Should retry listing and continue
- **Subsequent listings**: Should use cookies (no Flaresolverr calls)

### 7. Restart PM2 (if using PM2)
```bash
pm2 restart smartprop
pm2 logs smartprop --lines 100
```

## Troubleshooting

### If EC2 connection times out:
1. Check EC2 instance status in AWS Console
2. Verify security group allows SSH (port 22)
3. Check if instance IP has changed

### If you can't SSH:
Use AWS Systems Manager Session Manager or update security group rules.

## Performance Comparison

**Before Optimization:**
- Flaresolverr called: Every listing (~30-180s each)
- 20 listings: 600-3600 seconds (10-60 minutes)

**After Optimization:**
- Flaresolverr called: Once per district (or only if Cloudflare blocks)
- 20 listings: ~30-180 seconds total (only if needed)
- **Speed improvement: 10-20x faster**

