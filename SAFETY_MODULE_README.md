# AP3X Driver Safety + Vision + Dashcam Intelligence Layer

## Status: ✅ COMPLETE — NON-BREAKING ADD-ON

All features are **Driver PWA only**. Fleet Control OS has NOT been modified.

---

## New File Map

```
aaifcs/
├── modules_safety_ui_SafetyDashboard.jsx    ← Safety hub screen + sub-nav grid
├── modules_safety_ui_DashcamView.jsx        ← Live camera + recording + AI overlay
├── modules_safety_ui_HazardReportForm.jsx   ← Manual hazard report form
├── modules_safety_ui_IncidentTimeline.jsx   ← Session incident log
├── modules_safety_ui_RouteReplayView.jsx    ← SVG route replay with scrubber
├── modules_safety_ui_ExportCenter.jsx       ← Export incidents/route as CSV/JSON
├── services_safety_offlineVault.js          ← IndexedDB offline safety store
├── services_safety_syncService.js           ← Background Supabase sync (safety tables only)
├── services_safety_visionAI.js              ← On-device frame-sampling AI vision
├── services_safety_routeMemory.js           ← Local-first route snapshot + deviation tracking
└── sql_5_driver_safety_layer.sql            ← New Supabase tables (additive only)
```

---

## Architecture

```
Driver PWA (pages_DriverApp.jsx)
  └── Safety Tab (tab === 'safety')
        ├── safetyScreen === 'hub'       → SafetyDashboard (sub-nav)
        ├── safetyScreen === 'dashcam'   → DashcamView
        ├── safetyScreen === 'hazards'   → HazardReportForm
        ├── safetyScreen === 'incidents' → IncidentTimeline
        ├── safetyScreen === 'playback'  → RouteReplayView
        └── safetyScreen === 'export'    → ExportCenter

Services (isolated, driver-only)
  ├── offlineVault.js    → IndexedDB (incidents, route_snaps, dashcam_meta, ai_log, sync_queue)
  ├── syncService.js     → flushes sync_queue → Supabase (safety tables only)
  ├── visionAI.js        → canvas frame sampling → heuristic detections (no server)
  └── routeMemory.js     → polyline deviation tracking → local snapshot → sync on complete
```

---

## New Supabase Tables

Run `sql_5_driver_safety_layer.sql` in your Supabase SQL Editor.

| Table | Purpose |
|---|---|
| `safety_incidents` | Hazard reports, harsh events, fatigue alerts |
| `driver_route_memory` | Route geometry + deviation metadata |
| `driver_dashcam_events` | Dashcam clip metadata (no video stored in DB) |
| `driver_safety_exports` | Audit log of export actions |

All tables have:
- RLS enabled
- `driver_id` binding
- Dispatcher read-only policy
- Timestamp auditing

**Fleet OS tables are untouched.**

---

## Features

### 1. Safety Dashboard Hub
- Fatigue score + alert level banner (reuses existing `fatigueScore` / `alertLevel` state)
- Quick-access tiles for all 5 sub-screens
- No new global state — uses `safetyScreen` local state

### 2. Dashcam
- `getUserMedia` video feed (rear camera by default)
- Manual recording → WebM clip → local download
- Auto-trigger clip save on AI high-severity detection
- Toggle AI vision on/off
- Clip shelf with download links (browser-local only — no cloud upload)

### 3. AI Road Vision (On-Device)
- Runs every 3 seconds via `setInterval` — does NOT block navigation thread
- Canvas frame sampling (160×90 — minimal CPU)
- Detects: low visibility, road obstacles (dark lower-third), wet surface (hue heuristic)
- Emits warnings → dashcam overlay + optional clip trigger
- AI NEVER blocks or modifies driving/navigation logic

### 4. Hazard Report Form
- 8 hazard categories with GPS capture
- Saves to IndexedDB first (always succeeds offline)
- Syncs to `safety_incidents` on submit if online; queued otherwise

### 5. Incident Timeline
- Reads `safety_incidents` from Supabase (filtered by driver + task)
- Groups by type with colour coding
- Shows lat/lng + timestamp

### 6. Route Replay
- Reads `driver_locations` from Supabase (existing table — read only)
- SVG path rendering (no map library dependency)
- Scrubber + auto-play animation
- Speed + heading stats per point

### 7. Export Center
- Incidents → CSV
- Route trace → CSV
- Full session → JSON (incidents + route)
- All exports are browser file downloads — no cloud upload

### 8. Offline Safety Vault (IndexedDB)
- Stores: incidents, route snapshots, dashcam metadata, AI detections, sync queue
- Works 100% offline
- Sync queue flushed on `window.online` event + every 5 min while online
- Only writes to allowed safety tables — Fleet OS tables are blocked by allowlist

### 9. Route Memory Service
- Tracks breadcrumbs + deviations (>150 m off-route)
- Flags risk zones
- Syncs metadata (not geometry blob) to `driver_route_memory` on completion

---

## Privacy Notices (displayed in UI)

- "Driver Safety Recording Active"
- "On-Device AI Processing Enabled"
- "Evidence Capture Mode"

---

## Deployment

1. Run `sql_5_driver_safety_layer.sql` in Supabase SQL Editor
2. Deploy to Vercel — no new env vars required
3. All new modules are tree-shaken if unused

---

## Non-Breaking Guarantee

- ❌ No Fleet Control OS files modified
- ❌ No existing dispatch/routing logic changed
- ❌ No shared state conflicts introduced
- ❌ No existing navigation structure altered
- ✅ All features additive, isolated, toggleable
- ✅ All new Supabase tables additive — no schema changes to existing tables
