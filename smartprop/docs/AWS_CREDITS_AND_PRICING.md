# AWS Credits and Pricing Information

## Your Current Setup

**Account ID**: 283708190059  
**Region**: ap-southeast-1 (Singapore)  
**Current Instance**: t4g.small (i-0b41277535712c09b)  
**Instance Name**: smartprop-app

## Free Tier Information

### t4g Instance Free Trial (Until Dec 31, 2025)
- **Free Hours**: 750 hours/month
- **Applies to**: t4g.small, t4g.medium, t4g.large, t4g.xlarge
- **Status**: ✅ Your t4g.small is covered under this free trial

**Important**: This free trial expires on **December 31, 2025**. After that, standard pricing applies.

## Pricing Comparison (ap-southeast-1)

### Current: t4g.small
- **Specs**: 2 vCPU, 2GB RAM
- **Free until**: Dec 31, 2025 (750 hours/month)
- **After free tier**: ~$0.0168/hour (~$12.26/month if running 24/7)
- **Your cost now**: $0 (covered by free trial)

### Upgrade Option: t4g.medium
- **Specs**: 2 vCPU, 4GB RAM (2x memory)
- **Free until**: Dec 31, 2025 (750 hours/month)
- **After free tier**: ~$0.0336/hour (~$24.52/month if running 24/7)
- **Cost if upgraded now**: $0 (covered by free trial until Dec 31, 2025)

## Checking Your AWS Credits

### Method 1: AWS Console
1. Go to [AWS Billing Dashboard](https://console.aws.amazon.com/billing/)
2. Click "Credits" in the left sidebar
3. View your available credits and expiration dates

### Method 2: AWS CLI
```bash
# Check current month's costs
aws ce get-cost-and-usage \
  --time-period Start=2025-01-01,End=2025-01-31 \
  --granularity MONTHLY \
  --metrics BLENDED_COST

# Check credits (requires billing console access)
aws budgets describe-budgets --account-id 283708190059
```

## Cost Analysis

### Current Setup (t4g.small)
- **Monthly cost**: $0 (free trial until Dec 31, 2025)
- **After Dec 31, 2025**: ~$12.26/month (if running 24/7)

### If You Upgrade to t4g.medium
- **Monthly cost**: $0 (free trial until Dec 31, 2025)
- **After Dec 31, 2025**: ~$24.52/month (if running 24/7)
- **Additional cost**: ~$12.26/month more than t4g.small

## Recommendations

### ✅ Upgrade to t4g.medium NOW (Recommended)
**Why:**
- ✅ **FREE until Dec 31, 2025** (covered by free trial)
- ✅ **2x memory** (4GB vs 2GB) - much safer for Flaresolverr
- ✅ **No additional cost** until free trial expires
- ✅ **Better performance** - can use 1.5-2GB for Flaresolverr safely
- ✅ **More headroom** for other containers

**When to reconsider:**
- After Dec 31, 2025, if you want to save $12/month, you can downgrade back to t4g.small

### ⚠️ Stay on t4g.small
**Why:**
- Current setup works (with optimized 800MB limit)
- Saves $12/month after free trial expires

**Trade-offs:**
- Less memory headroom
- Need to carefully manage resource limits
- Higher risk of OOM kills under load

## Action Plan

### To Check Your Credits:
1. **AWS Console**: https://console.aws.amazon.com/billing/home?region=ap-southeast-1#/credits
2. Look for:
   - Available credits balance
   - Expiration dates
   - Usage history

### To Upgrade to t4g.medium:
```bash
# Stop the instance
aws ec2 stop-instances --instance-ids i-0b41277535712c09b --region ap-southeast-1

# Change instance type
aws ec2 modify-instance-attribute \
  --instance-id i-0b41277535712c09b \
  --instance-type Value=t4g.medium \
  --region ap-southeast-1

# Start the instance
aws ec2 start-instances --instance-ids i-0b41277535712c09b --region ap-southeast-1
```

**Note**: You may need to stop the instance first before changing the type.

## Summary

| Option | Cost Now | Cost After Dec 31, 2025 | Memory | Recommendation |
|--------|----------|-------------------------|--------|----------------|
| **t4g.small** (current) | $0 | ~$12/month | 2GB | Works, but tight |
| **t4g.medium** (upgrade) | $0 | ~$24/month | 4GB | ✅ **Best choice** |

**My Recommendation**: Upgrade to t4g.medium NOW while it's still free. You get 2x memory at no cost until Dec 31, 2025. After that, you can decide if the extra $12/month is worth it for better stability.





