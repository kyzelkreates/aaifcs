/**
 * ============================================================
 * APEX AI — Federation Sync Payload Builder
 *
 * Builds signed, tenant-scoped payloads ready for future
 * Command Center ingestion. All payloads are:
 *   - tenant_id stamped
 *   - fleet_entity_id stamped
 *   - device_id stamped
 *   - signed with sync_identity
 *   - versioned
 *   - schema-typed
 *
 * Supported payload types:
 *   telemetry_event   — live GPS/speed/fatigue events
 *   route_metric      — completed route stats
 *   ai_metric         — AI inference record
 *   api_usage         — external API call log
 *   operational_event — fleet ops (job, dispatch, incident)
 *   safety_event      — safety alerts
 *   financial_event   — cost/revenue event (future billing)
 *   sync_snapshot     — full entity state snapshot
 *   driver_session    — driver session summary
 * ============================================================
 */

import { tenantRegistry } from './services_federation_tenantRegistry'

const PAYLOAD_VERSION = '2.0'

// ─── Device ID (stable per browser instance) ──────────────────
let _deviceId = null
function getDeviceId() {
  if (_deviceId) return _deviceId
  try {
    _deviceId = localStorage.getItem('apex:device:id')
    if (!_deviceId) {
      _deviceId = `DEV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase()
      localStorage.setItem('apex:device:id', _deviceId)
    }
  } catch {
    _deviceId = 'DEV-UNKNOWN'
  }
  return _deviceId
}

// ─── Payload envelope ─────────────────────────────────────────
function envelope(type, data) {
  const identity = tenantRegistry.getOrCreate()
  return {
    _meta: {
      version:         PAYLOAD_VERSION,
      payload_type:    type,
      tenant_id:       identity.tenant_id,
      fleet_entity_id: identity.fleet_entity_id,
      device_id:       getDeviceId(),
      sync_identity:   identity.sync_identity,
      ts:              new Date().toISOString(),
      schema:          `apex.${type}.v${PAYLOAD_VERSION}`,
    },
    data,
  }
}

// ─── Public builders ──────────────────────────────────────────

/** Telemetry event from driver app GPS tick */
export function buildTelemetryEvent(telemetry) {
  return envelope('telemetry_event', {
    driver_id:    telemetry.driver_id,
    driver_name:  telemetry.driver_name,
    vehicle_id:   telemetry.vehicle_id,
    vehicle_reg:  telemetry.vehicle_reg,
    lat:          telemetry.lat,
    lng:          telemetry.lng,
    speed:        telemetry.speed,
    heading:      telemetry.heading,
    accuracy:     telemetry.accuracy,
    trip_dist_m:  telemetry.trip_dist_m,
    destination:  telemetry.destination || null,
    fatigue_score: telemetry.fatigue_score || null,
    alert_level:  telemetry.alert_level || null,
    source:       'driver_app',
  })
}

/** Completed route stats */
export function buildRouteMetric(route) {
  return envelope('route_metric', {
    driver_id:       route.driver_id,
    vehicle_id:      route.vehicle_id,
    vehicle_reg:     route.vehicle_reg,
    job_id:          route.job_id || null,
    origin:          route.origin,
    destination:     route.destination,
    distance_m:      route.distance_m,
    duration_s:      route.duration_s,
    provider:        route.provider,
    cached:          route.cached || false,
    local_compute:   route.local_compute || false,
    waypoints:       route.waypoints || [],
    route_score:     route.route_score || null,
    fuel_estimate_l: route.fuel_estimate_l || null,
    started_at:      route.started_at,
    completed_at:    route.completed_at || new Date().toISOString(),
  })
}

/** AI inference record — tracks token usage per tenant */
export function buildAIMetric(metric) {
  return envelope('ai_metric', {
    module:          metric.module,          // sentinel, routemind, predict, compliance
    provider:        metric.provider,        // openai, ollama, mistral, etc.
    model:           metric.model,
    prompt_tokens:   metric.prompt_tokens   || 0,
    completion_tokens: metric.completion_tokens || 0,
    total_tokens:    metric.total_tokens    || 0,
    latency_ms:      metric.latency_ms      || 0,
    local_inference: metric.local_inference || false,
    cost_usd:        metric.cost_usd        || 0,
    cached:          metric.cached          || false,
    driver_id:       metric.driver_id       || null,
    success:         metric.success !== false,
  })
}

/** External API call log */
export function buildApiUsageEvent(api) {
  return envelope('api_usage', {
    api_type:    api.api_type,     // routing, geocoding, traffic, ai
    provider:    api.provider,     // graphhopper, google, openai, osrm
    endpoint:    api.endpoint,
    success:     api.success,
    latency_ms:  api.latency_ms   || 0,
    cached:      api.cached       || false,
    fallback:    api.fallback      || false,
    error_code:  api.error_code   || null,
    cost_units:  api.cost_units   || 0,    // API credits consumed
  })
}

/** Operational event — jobs, dispatch, incidents */
export function buildOperationalEvent(event) {
  return envelope('operational_event', {
    event_type:  event.event_type,  // job_created, job_completed, dispatch, incident
    entity_type: event.entity_type, // job, vehicle, driver
    entity_id:   event.entity_id,
    driver_id:   event.driver_id   || null,
    vehicle_id:  event.vehicle_id  || null,
    status:      event.status      || null,
    metadata:    event.metadata    || {},
  })
}

/** Safety alert event */
export function buildSafetyEvent(alert) {
  return envelope('safety_event', {
    alert_type:  alert.type,
    severity:    alert.severity,
    driver_id:   alert.driver_id,
    vehicle_id:  alert.vehicle_id,
    vehicle_reg: alert.vehicle_reg  || null,
    driver_name: alert.driver_name  || null,
    description: alert.description,
    resolved:    alert.resolved     || false,
    lat:         alert.lat          || null,
    lng:         alert.lng          || null,
    speed:       alert.speed        || null,
  })
}

/** Financial event — future billing/cost tracking */
export function buildFinancialEvent(event) {
  return envelope('financial_event', {
    event_type:   event.event_type,  // api_cost, fuel_cost, maintenance_cost
    amount_usd:   event.amount_usd  || 0,
    currency:     event.currency    || 'USD',
    description:  event.description,
    category:     event.category,
    reference_id: event.reference_id || null,
    metadata:     event.metadata     || {},
  })
}

/** Full entity state snapshot — for delta-sync and recovery */
export function buildSyncSnapshot(entities) {
  return envelope('sync_snapshot', {
    vehicles:    entities.vehicles    || [],
    drivers:     entities.drivers     || [],
    jobs:        entities.jobs        || [],
    incidents:   entities.incidents   || [],
    record_counts: {
      vehicles:  (entities.vehicles  || []).length,
      drivers:   (entities.drivers   || []).length,
      jobs:      (entities.jobs      || []).length,
      incidents: (entities.incidents || []).length,
    },
  })
}

/** Driver session summary */
export function buildDriverSessionEvent(session) {
  return envelope('driver_session', {
    driver_id:       session.driver_id,
    driver_name:     session.driver_name,
    vehicle_id:      session.vehicle_id,
    vehicle_reg:     session.vehicle_reg,
    session_start:   session.session_start,
    session_end:     session.session_end || new Date().toISOString(),
    duration_s:      session.duration_s,
    distance_m:      session.distance_m,
    avg_speed:       session.avg_speed,
    max_speed:       session.max_speed,
    fatigue_peak:    session.fatigue_peak || null,
    alerts_triggered: session.alerts_triggered || 0,
    breaks_taken:    session.breaks_taken || 0,
  })
}
