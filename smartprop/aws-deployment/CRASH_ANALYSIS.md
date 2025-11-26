# EC2 System Crash Analysis & Recovery Report

**Date:** 2025-11-26  
**Instance:** i-0b41277535712c09b (t4g.medium - 4GB RAM)  
**Public IP:** 52.76.114.103  
**Status:** Rebooted, services need verification

## 🔍 Root Cause Analysis

### Primary Issue: Out of Memory (OOM) Kills

The system crashed due to **excessive memory consumption** from multiple concurrent Chromium/Chrome processes running scrapers.

### Detailed Findings:

1. **OOM Kills Detected:**
   - Process 1009377 (chromium) - Memory cgroup OOM
   - Process 2701424 (chrome) - Global OOM  
   - Process 2204308 (chromium) - Docker container OOM

2. **Memory Consumption Pattern:**
   - **50+ Chromium/Chrome processes** running simultaneously
   - Each process using **300-800MB+ RSS** (Resident Set Size)
   - **Total swap exhausted** (0kB free of 2GB)
   - **System memory completely consumed** (only 14MB free)

3. **Processes Running at Time of Crash:**
   - Multiple chromium processes (scrapers - PropertyGuru/EdgeProp)
   - Next.js server (bun/node) - ~25MB RSS
   - Docker containers (WAHA, Flaresolverr)
   - Nginx web server
   - PM2 process manager
   - System services

4. **Memory Breakdown:**
   - Active anonymous memory: ~1.3GB
   - Inactive anonymous memory: ~2.1GB
   - Total swap: 2GB (completely full)
   - Free memory: Only 14MB available

### Root Cause:

**No concurrency limits or memory constraints on scraper processes.** When multiple scraping jobs run simultaneously, each spawns Chromium instances that consume 300-800MB each. With 50+ processes, this quickly exhausts the 4GB RAM on a t4g.medium instance.

## ✅ Actions Taken

1. ✅ **Rebooted instance** - Cleared memory and reset system state
2. ✅ **Verified instance status** - Instance is running and healthy
3. ⚠️ **Services not responding** - HTTP/HTTPS endpoints not accessible yet

## ⚠️ Current Status

- **Instance State:** ✅ Running
- **Instance Status:** ✅ OK
- **System Status:** ✅ OK
- **HTTP Endpoints:** ❌ Not responding (may need manual service start)
- **SSH Access:** ❌ Timing out (may be network/firewall issue)

## 🔧 Required Fixes

### Immediate (Critical):

1. **Add Concurrency Limits:**
   - Limit concurrent scraper jobs to 2-3 maximum
   - Implement queue system for scraping jobs
   - Add memory limits per scraper process

2. **Add Memory Constraints:**
   - Set memory limits on Docker containers
   - Limit Chromium memory usage via flags
   - Implement process monitoring and auto-kill on high memory

3. **Upgrade Instance Type:**
   - Current: t4g.medium (4GB RAM) - **INSUFFICIENT**
   - Recommended: t4g.large (8GB RAM) or t4g.xlarge (16GB RAM)

### Long-term:

1. **Implement Scraper Queue:**
   - Use job queue (Bull, BullMQ, or similar)
   - Process scrapers sequentially or with limited concurrency
   - Add memory monitoring and auto-throttling

2. **Optimize Memory Usage:**
   - Use headless Chrome with minimal flags
   - Implement process pooling/reuse
   - Add memory limits to all containers

3. **Monitoring:**
   - Add CloudWatch alarms for memory usage
   - Set up alerts when memory exceeds 80%
   - Monitor OOM kills

## 📋 Next Steps

1. **Verify Services Are Running:**
   - Check if services auto-start on boot
   - Manually start services if needed
   - Verify Docker containers are running

2. **Implement Fixes:**
   - Add concurrency limits to scrapers
   - Set memory limits
   - Consider instance upgrade

3. **Test:**
   - Run scrapers with limits
   - Monitor memory usage
   - Verify system stability

## 🔗 Related Files

- Scraper configuration: `src/app/admin/scraper/actions.ts`
- PropertyGuru scraper: `src/workers/pg.districts.ts`
- EdgeProp scraper: `src/workers/ep.live.ts`
- EC2 setup script: `aws-deployment/ec2-setup.sh`

