# Manual PropertyGuru Authentication Guide

## 🔗 Login URL

**PropertyGuru Login Page:**
```
https://www.propertyguru.com.sg/login
```

## 📋 Manual Authentication Steps

### Option 1: Using the Auth Script in Headed Mode (Recommended)

1. **SSH into EC2:**
   ```bash
   ssh -i smartprop-new-key.pem ${EC2_USER:-ec2-user}@${EC2_IP}
   ```

2. **Navigate to the project:**
   ```bash
   cd /opt/smartprop/app/smartprop
   ```

3. **Set environment variables (if not already set):**
   ```bash
   export PG_EMAIL="your-email@example.com"
   export PG_PASSWORD="your-password"
   export HEADLESS="false"  # Force headed mode
   export DISPLAY=:99  # If using Xvfb
   ```

4. **Run the authentication script in headed mode:**
   ```bash
   export PATH="/home/ec2-user/.bun/bin:$PATH"
   /home/ec2-user/.bun/bin/bun src/workers/auth.pg.ts
   ```

5. **Manually complete the Cloudflare challenge:**
   - The browser window will open
   - Complete any Cloudflare verification
   - Log in with your credentials
   - The script will automatically save the state file

### Option 2: Using Browser DevTools (Advanced)

1. **Open PropertyGuru login page:**
   ```
   https://www.propertyguru.com.sg/login
   ```

2. **Complete Cloudflare challenge manually**

3. **Log in with your credentials**

4. **Extract cookies from browser:**
   - Open DevTools (F12)
   - Go to Application/Storage tab
   - Copy all cookies for `www.propertyguru.com.sg`

5. **Create state file on EC2:**
   ```bash
   ssh -i smartprop-new-key.pem ${EC2_USER:-ec2-user}@${EC2_IP}
   cd /opt/smartprop/app/smartprop
   ```

6. **Create `storage/pg.state.json`:**
   ```json
   {
     "cookies": [
       {
         "name": "cookie_name",
         "value": "cookie_value",
         "domain": ".propertyguru.com.sg",
         "path": "/",
         "expires": 1234567890,
         "httpOnly": true,
         "secure": true,
         "sameSite": "Lax"
       }
       // ... add all cookies here
     ],
     "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
     "authenticatedAt": "2026-01-22T00:00:00.000Z"
   }
   ```

## 📁 State File Location

The authentication state is saved to:
```
/opt/smartprop/app/smartprop/storage/pg.state.json
```

## ✅ Verify Authentication

After manual authentication, verify the state file exists:
```bash
ssh -i smartprop-new-key.pem ${EC2_USER:-ec2-user}@${EC2_IP}
cd /opt/smartprop/app/smartprop
ls -lh storage/pg.state.json
```

Check cookie count:
```bash
python3 -c "import json; f=open('storage/pg.state.json'); d=json.load(f); print(f'Cookies: {len(d.get(\"cookies\",[]))}'); f.close()"
```

## 🔄 When to Re-authenticate

The state file may expire if:
- Cookies expire (usually 30 days)
- PropertyGuru detects suspicious activity
- IP address changes significantly
- Scraper fails with authentication errors

## 🛠️ Troubleshooting

### If browser doesn't open:
- Check if Xvfb is running: `ps aux | grep Xvfb`
- Start Xvfb: `Xvfb :99 -screen 0 1024x768x24 &`
- Set DISPLAY: `export DISPLAY=:99`

### If Cloudflare keeps blocking:
- Try from a different IP address
- Wait a few hours between attempts
- Clear browser cache and cookies
- Use a VPN or residential proxy

### If state file is not created:
- Check write permissions: `ls -ld storage/`
- Check disk space: `df -h`
- Review error logs: `tail -50 /tmp/pg-auth-*.log`
