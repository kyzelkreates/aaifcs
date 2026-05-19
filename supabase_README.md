# Apex AI — Supabase Setup Guide

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Choose a region close to your users (EU West recommended for UK fleets)
3. Set a strong database password

## 2. Run the Schema

In the Supabase dashboard → **SQL Editor** → paste the full contents of `schema.sql` and run it.

This creates 11 tables:
- `vehicles` — vehicle registry with live telemetry fields
- `drivers` — driver profiles, licences, safety scores
- `vehicle_telemetry` — time-series telemetry stream (realtime enabled)
- `safety_alerts` — AI-generated safety events (realtime enabled)
- `driver_scores` — daily driver scoring records
- `dispatch_jobs` — job board
- `compliance_records` — regulatory compliance tracking
- `incidents` — incident reports
- `message_channels` — fleet comms channels (realtime enabled)
- `messages` — channel messages (realtime enabled)
- `driver_hours` — HGV/LGV hours tracking

## 3. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill in:
```
VITE_SUPABASE_URL=https://your-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Both values are in Supabase dashboard → **Settings → API**.

## 4. Enable Realtime

Supabase dashboard → **Database → Replication** → enable for:
- `vehicle_telemetry`
- `safety_alerts`
- `message_channels`
- `messages`

(The schema SQL attempts this automatically but confirm in the dashboard.)

## 5. Set Up Auth

Supabase dashboard → **Authentication → Providers**:
- Email/Password — **enabled** (required)
- Magic Link — optional
- Social providers — optional

Under **Authentication → URL Configuration**:
- Site URL: `http://localhost:3000` (dev) or your production domain
- Redirect URLs: add your production domain

## 6. RLS Policies

The schema enables RLS on all tables with a default policy:
> Authenticated users have full access

For production, tighten these policies:
- Drivers should only see their own records
- Fleet managers see all records
- Admins see everything

See [Supabase RLS docs](https://supabase.com/docs/guides/auth/row-level-security).

---

## Running the App

```bash
npm install
npm run dev          # development
npm run build        # production build
npm run preview      # preview production build
```

## Deploy Options

### Vercel
```bash
npm i -g vercel
vercel --prod
```
Set all `VITE_*` environment variables in the Vercel dashboard.

### Netlify
```bash
npm run build
# drag dist/ to netlify.com/drop
```
Or connect your Git repo and set build command to `npm run build`, publish dir to `dist`.

### Self-hosted (NGINX)
```bash
npm run build
# copy dist/ to your web server root
```
NGINX config:
```nginx
server {
    listen 80;
    root /var/www/apex-ai/dist;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
```

---

## AI Provider Setup (minimum 1 required)

| Provider   | Get Key | Recommended For |
|------------|---------|-----------------|
| OpenAI     | platform.openai.com | Best quality |
| Groq       | console.groq.com | Fastest, free tier |
| OpenRouter | openrouter.ai | Multi-model access |
| Ollama     | ollama.ai (self-hosted) | Privacy / offline |

Set your chosen key(s) in `.env` — the app auto-selects the best available provider.
