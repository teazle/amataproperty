# Upgrade EC2 Instance to t4g.medium

## ⚠️ Important Finding

**API Limitation**: The AWS CLI `modify-instance-attribute` command is restricted for free tier accounts. You'll need to use the AWS Console instead.

## ✅ Confirmed: It's FREE!

- **Current Cost**: $0 (EC2 Compute shows $0 in billing)
- **t4g.medium Cost**: $0 until Dec 31, 2025 (covered by free trial)
- **After Dec 31, 2025**: ~$24.52/month

## How to Upgrade via AWS Console

### Step 1: Stop the Instance
1. Go to [EC2 Console](https://console.aws.amazon.com/ec2/v2/home?region=ap-southeast-1#Instances:)
2. Select instance: **i-0b41277535712c09b** (smartprop-app)
3. Click **"Instance state"** → **"Stop instance"**
4. Wait for status to show **"stopped"** (takes ~30-60 seconds)

### Step 2: Change Instance Type
1. With instance selected (and stopped), click **"Actions"** → **"Instance settings"** → **"Change instance type"**
2. Select **t4g.medium** from the dropdown
3. Click **"Apply"**

### Step 3: Start the Instance
1. Click **"Instance state"** → **"Start instance"**
2. Wait for status to show **"running"** (takes ~30-60 seconds)

## Alternative: Using AWS CLI (if you upgrade account)

If you upgrade your AWS account plan, you can use:

```bash
# Stop instance
aws ec2 stop-instances --instance-ids i-0b41277535712c09b --region ap-southeast-1

# Wait for stopped state
aws ec2 wait instance-stopped --instance-ids i-0b41277535712c09b --region ap-southeast-1

# Modify instance type (requires upgraded account)
aws ec2 modify-instance-attribute \
  --instance-id i-0b41277535712c09b \
  --instance-type Value=t4g.medium \
  --region ap-southeast-1

# Start instance
aws ec2 start-instances --instance-ids i-0b41277535712c09b --region ap-southeast-1
```

## After Upgrade

Once upgraded to t4g.medium, you can update your docker-compose.prod.yml:

```yaml
flaresolverr:
  deploy:
    resources:
      limits:
        memory: 1.5G  # Can safely increase from 800M
        cpus: '1.0'   # Can increase from 0.75
```

## Cost Verification

After upgrading, verify it's still free:
1. Go to [Cost Explorer](https://console.aws.amazon.com/cost-management/home?region=ap-southeast-1#/cost-explorer)
2. Check "Amazon Elastic Compute Cloud - Compute" costs
3. Should show $0 until Dec 31, 2025

## Summary

- ✅ **Current**: t4g.small (2GB RAM) - FREE
- ✅ **Upgrade to**: t4g.medium (4GB RAM) - FREE until Dec 31, 2025
- ⚠️ **Method**: Must use AWS Console (API restricted for free tier)
- 💰 **Cost**: $0 now, ~$24.52/month after Dec 31, 2025

The instance has been stopped and is ready for you to upgrade via the console!





