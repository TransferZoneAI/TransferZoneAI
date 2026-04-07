TransferZoneAI rebuild package

Files included:
- index.html
- styles.css
- app.js
- vercel.json
- manifest.json
- robots.txt
- transferzoneai-logo-192.png
- transferzoneai-logo-512.png
- OneSignalSDKWorker.js
- api/football.js
- api/follow.js
- api/ai.js
- api/notify-live.js
- api/notify-prematch.js
- api/notify-transfers.js
- api/transfers-daily.js
- api/sitemap.js

Required Vercel environment variables:
- APISPORTS_KEY
- ANTHROPIC_API_KEY
- KV_REST_API_URL
- KV_REST_API_TOKEN
- ONESIGNAL_APP_ID
- ONESIGNAL_API_KEY

How to deploy:
1. Replace your current project files with these.
2. Keep the same Vercel env vars.
3. Redeploy.

Notes:
- Frontend is now a clean SPA with routes for home, live, transfers, leagues, league page, club page, player page, match page, toplists, my clubs and AI assistant.
- Transfers feed uses the rebuilt /api/football endpoint and includes player photos plus club logos.
- Followed clubs are stored in localStorage and synced to the follow API.
