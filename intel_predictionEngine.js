/**
 * ============================================================
 * APEX INTELLIGENCE — Prediction Engine
 * File: intel_predictionEngine.js
 *
 * Predicts future operational problems before they happen.
 * Uses historical data from routeMemory + fleetLearning.
 * NO external APIs. NO AI calls. Heuristic rule engine.
 *
 * Predicts:
 *  - Late deliveries (before dispatch)
 *  - Future congestion windows
 *  - Route failure risk
 *  - Depot overload risk
 *  - High-risk schedules
 *  - Weather disruption probability
 *  - Driver fatigue risk at arrival
 * ============================================================
 */

import routeMemory  from './intel_routeMemory'
import fleetLearning from './intel_fleetLearning'

export const PREDICTION_CONFIDENCE = {
  HIGH:   'high',    // ≥5 samples
  MEDIUM: 'medium',  // 2-4 samples
  LOW:    'low',     // 1 sample / heuristic only
  NONE:   'none',    // no data
}

function confidenceFromSamples(n) {
  if (n >= 5) return PREDICTION_CONFIDENCE.HIGH
  if (n >= 2) return PREDICTION_CONFIDENCE.MEDIUM
  if (n >= 1) return PREDICTION_CONFIDENCE.LOW
  return PREDICTION_CONFIDENCE.NONE
}

export const predictionEngine = {

  /**
   * Predict whether a job will be delivered on time.
   * @param {object} job        - job record
   * @param {object} origin     - { lat, lng }
   * @param {object} destination - { lat, lng }
   * @param {object} route      - normalised route
   * @returns {object} DeliveryPrediction
   */
  predictOnTime(job, origin, destination, route) {
    const scheduledTs = job.scheduled_at ? new Date(job.scheduled_at).getTime() : null
    const now         = Date.now()

    if (!scheduledTs) {
      return { confidence: PREDICTION_CONFIDENCE.NONE, onTimeProbability: null, reason: 'No deadline set' }
    }

    const estDurationS = route?.duration || route?.duration_s || 0
    const predictedArr = now + estDurationS * 1000

    // Historical delay data
    const delay = routeMemory.getCorridorDelay(origin, destination, {
      dow:    new Date().getDay(),
      bucket: Math.floor(new Date().getHours() * 2 + (new Date().getMinutes() >= 30 ? 1 : 0)),
    })

    let adjustedArrival = predictedArr
    if (delay?.avg_delay_s) {
      adjustedArrival += delay.avg_delay_s * 1000
    }

    const bufferMs    = scheduledTs - adjustedArrival
    const bufferMin   = bufferMs / 60000

    let probability, risk
    if (bufferMin > 30)  { probability = 95; risk = 'low'      }
    else if (bufferMin > 10)  { probability = 80; risk = 'low'      }
    else if (bufferMin > 0)   { probability = 65; risk = 'moderate'  }
    else if (bufferMin > -15) { probability = 35; risk = 'high'      }
    else if (bufferMin > -30) { probability = 15; risk = 'high'      }
    else                      { probability = 5;  risk = 'critical'  }

    // Corridor reliability modifier
    const reliability = routeMemory.getCorridorReliability(origin, destination)
    if (reliability !== null) {
      probability = Math.round(probability * 0.7 + reliability * 100 * 0.3)
    }

    return {
      confidence:         confidenceFromSamples(delay?.samples || 0),
      onTimeProbability:  Math.min(100, Math.max(0, probability)),
      riskLevel:          risk,
      bufferMinutes:      Math.round(bufferMin),
      historicalDelay:    delay,
      predictedArrival:   new Date(adjustedArrival).toISOString(),
      scheduledDeadline:  new Date(scheduledTs).toISOString(),
    }
  },

  /**
   * Predict congestion risk on an OD corridor at a given departure time.
   */
  predictCongestion(origin, destination, departureTs = Date.now()) {
    const predicted = routeMemory.predictDuration(origin, destination, departureTs)
    const fleet     = fleetLearning.getUtilisationForecast(departureTs)

    if (!predicted) {
      // Fall back to time-of-day heuristic
      const hour = new Date(departureTs).getHours()
      const isRush = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19)
      return {
        confidence:      PREDICTION_CONFIDENCE.LOW,
        congestionRisk:  isRush ? 'moderate' : 'low',
        predictedDelayS: isRush ? 600 : 0,
        source:          'heuristic',
      }
    }

    const delay = routeMemory.getCorridorDelay(origin, destination, {
      dow:    new Date(departureTs).getDay(),
      bucket: Math.floor(new Date(departureTs).getHours() * 2 + (new Date(departureTs).getMinutes() >= 30 ? 1 : 0)),
    })

    const avgDelay   = delay?.avg_delay_s || 0
    const congestionRisk = avgDelay > 1800 ? 'high' : avgDelay > 600 ? 'moderate' : 'low'

    return {
      confidence:        confidenceFromSamples(delay?.samples || 0),
      congestionRisk,
      predictedDelay:    delay,
      predictedDurationS: predicted,
      fleetUtilisation:  fleet,
      source:            'historical',
    }
  },

  /**
   * Predict route failure risk.
   */
  predictRouteFailure(origin, destination) {
    const reliability = routeMemory.getCorridorReliability(origin, destination)
    const failures    = routeMemory.getFailureHistory(origin, destination, 10)
    const dangerous   = routeMemory.getDangerousSegmentsNear(origin.lat, origin.lng, 0.05)

    if (reliability === null) {
      return { confidence: PREDICTION_CONFIDENCE.NONE, failureRisk: 'unknown', failureProbability: null }
    }

    const failureProbability = Math.round((1 - reliability) * 100)
    const risk = failureProbability > 40 ? 'high' : failureProbability > 20 ? 'moderate' : 'low'

    // Most common failure reason
    const reasons = failures.map(f => f.reason).filter(Boolean)
    const topReason = reasons.length > 0
      ? reasons.sort((a, b) =>
          reasons.filter(r => r === b).length - reasons.filter(r => r === a).length
        )[0]
      : null

    return {
      confidence:          confidenceFromSamples(failures.length),
      failureRisk:         risk,
      failureProbability,
      topFailureReason:    topReason,
      dangerousSegments:   dangerous.length,
      historicalFailures:  failures.length,
    }
  },

  /**
   * Predict depot overload at a given time.
   */
  predictDepotOverload(depotId = 'main', ts = Date.now()) {
    const forecast = fleetLearning.getDepotCongestionForecast(depotId, ts)
    const bestTime = fleetLearning.getBestDispatchTime(depotId, new Date(ts).getDay())

    return {
      forecast,
      bestDispatchTime: bestTime,
      overloadRisk:     forecast.congestionLevel === 'high' ? 'high'
                      : forecast.congestionLevel === 'moderate' ? 'moderate'
                      : 'low',
      recommendation:   bestTime
        ? `Consider dispatching at ${bestTime.timeLabel} for lowest congestion`
        : null,
    }
  },

  /**
   * Predict driver fatigue at estimated arrival time.
   * @param {object} driver
   * @param {number} sessionHoursAlready - hours already driven today
   * @param {number} journeyHours        - estimated journey hours
   */
  predictDriverFatigue(driver, sessionHoursAlready, journeyHours) {
    const totalHours = sessionHoursAlready + journeyHours
    const euDailyMax = 9

    let fatigueRisk, fatigueScore
    if (totalHours > 10)        { fatigueRisk = 'critical'; fatigueScore = 95 }
    else if (totalHours > 9)    { fatigueRisk = 'high';     fatigueScore = 75 }
    else if (totalHours > 7)    { fatigueRisk = 'moderate'; fatigueScore = 55 }
    else if (totalHours > 4.5)  { fatigueRisk = 'low';      fatigueScore = 35 }
    else                        { fatigueRisk = 'none';     fatigueScore = 10 }

    const breaksNeeded = Math.floor(journeyHours / 4.5)

    return {
      fatigueRisk,
      fatigueScore,
      totalSessionHours: Math.round(totalHours * 10) / 10,
      euLimitH:          euDailyMax,
      remainingLegalH:   Math.max(0, Math.round((euDailyMax - totalHours) * 10) / 10),
      breaksNeeded,
      recommendation:    fatigueRisk !== 'none'
        ? `Plan ${breaksNeeded} break${breaksNeeded !== 1 ? 's' : ''} of 45+ min during journey`
        : null,
    }
  },

  /**
   * Predict weather disruption probability for a corridor.
   */
  predictWeatherDisruption(origin, destination) {
    const failures = routeMemory.getFailureHistory(origin, destination, 20)
    const weatherFails = failures.filter(f => f.reason === 'weather')

    const month = new Date().getMonth()
    const winterRisk = [11, 0, 1].includes(month) ? 0.3 : [10, 2].includes(month) ? 0.15 : 0.05
    const historicalRate = failures.length > 0 ? weatherFails.length / failures.length : 0
    const probability    = Math.round((historicalRate * 0.6 + winterRisk * 0.4) * 100)

    return {
      confidence:       confidenceFromSamples(failures.length),
      disruptionRisk:   probability > 40 ? 'high' : probability > 20 ? 'moderate' : 'low',
      probability,
      historicalSamples: failures.length,
      weatherFailures:   weatherFails.length,
    }
  },

  /**
   * Full schedule risk assessment for a fleet of jobs.
   * Returns array of jobs with their risk predictions.
   */
  assessScheduleRisk(jobs, origin) {
    return jobs.map(job => {
      const dest = job.destination_coords || { lat: 0, lng: 0 }
      const failureRisk   = this.predictRouteFailure(origin, dest)
      const congestionRisk = this.predictCongestion(origin, dest, Date.now())
      const weatherRisk   = this.predictWeatherDisruption(origin, dest)

      const overallRisk = Math.max(
        failureRisk.failureProbability || 0,
        weatherRisk.probability || 0,
        congestionRisk.congestionRisk === 'high' ? 60
          : congestionRisk.congestionRisk === 'moderate' ? 35 : 10
      )

      return {
        job_id:    job.id,
        overallRisk,
        riskLevel: overallRisk > 60 ? 'high' : overallRisk > 30 ? 'moderate' : 'low',
        failureRisk,
        congestionRisk,
        weatherRisk,
      }
    }).sort((a, b) => b.overallRisk - a.overallRisk)
  },
}

export default predictionEngine
