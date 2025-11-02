# ngrok Setup Guide

## Quick Start

### 1. Start Your Next.js Application
```bash
cd /Users/vincent/propertydemo/smartprop
bun run dev
```
The app typically runs on `http://localhost:3000`

### 2. Start ngrok (in a new terminal)
```bash
ngrok http 3000
```

This will create a public URL that tunnels to your local application.

### 3. Share the URL with Your Client
ngrok will display something like:
```
Forwarding    https://xxxx-xxx-xxx-xxx.ngrok-free.app -> http://localhost:3000
```

Share the `https://xxxx-xxx-xxx-xxx.ngrok-free.app` URL with your client.

## Important Considerations

### Environment Variables
If your app uses webhooks or needs to know its public URL, you may need to update your environment variables:

```bash
# Add to your .env.local
NEXT_PUBLIC_APP_URL=https://your-ngrok-url.ngrok-free.app
```

### WhatsApp Webhook (WAHA)
If you're using WhatsApp features, you'll need to update the webhook URL in your WAHA instance:
1. Update the webhook URL to point to: `https://your-ngrok-url.ngrok-free.app/api/wa/webhook`
2. Make sure your WAHA instance can reach the ngrok URL

### Database Access
Make sure your Supabase database is accessible from the internet (which it should be by default).

### Static Domain (Recommended for Production Demo)
For a more professional demo, consider using ngrok's static domain feature:

```bash
# Sign up for a free ngrok account at https://ngrok.com
# Get your auth token from the dashboard
ngrok config add-authtoken YOUR_AUTH_TOKEN

# Reserve a static domain (requires paid plan) or use subdomain
ngrok http 3000 --subdomain=your-custom-name
```

## Troubleshooting

### Port Already in Use
If port 3000 is already in use, check what port your app is running on:
```bash
lsof -i :3000
```

### ngrok Session Timeout
Free ngrok sessions expire after 2 hours. You'll need to restart ngrok and share the new URL.

### CORS Issues
If you encounter CORS issues, you may need to update your Next.js config to allow the ngrok domain.

## Alternative: Using ngrok with Custom Port
If your app runs on a different port (e.g., 3001):
```bash
ngrok http 3001
```

## Security Notes
- The free ngrok tier shows a warning page before accessing your site
- Don't share sensitive data over free ngrok tunnels
- Consider using ngrok's authentication features for added security:
  ```bash
  ngrok http 3000 --basic-auth="username:password"
  ```

## Keeping It Running
To keep both your app and ngrok running:
1. Terminal 1: `cd /Users/vincent/propertydemo/smartprop && bun run dev`
2. Terminal 2: `ngrok http 3000`

Leave both terminals open while demoing to your client.

