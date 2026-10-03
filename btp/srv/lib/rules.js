/**
 * Sensing & Scenario agent — temperature threshold rules.
 *
 * Works on a shipment's recent reefer readings (newest last) and decides
 * whether the cold chain is fine, on watch, or in excursion.
 *
 * Exposure budget: vaccines tolerate a limited cumulative time above the
 * upper limit. We model a 150-minute budget above 8 °C, consumed faster the
 * hotter the load gets. Remaining budget = "time to breach" shown in the app.
 */

const EXPOSURE_BUDGET_MIN = 150;

function minutesBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000;
}

/** Least-squares slope of temperature over time, in °C per hour. */
function slopePerHour(readings) {
  if (readings.length < 2) return 0;
  const t0 = new Date(readings[0].ts).getTime();
  const xs = readings.map((r) => (new Date(r.ts).getTime() - t0) / 3600000);
  const ys = readings.map((r) => Number(r.temperature));
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Minutes the load has been continuously above the limit (up to the latest reading). */
function minutesAboveLimit(readings, maxTemp) {
  let start = null;
  for (let i = readings.length - 1; i >= 0; i -= 1) {
    if (Number(readings[i].temperature) > maxTemp) start = readings[i].ts;
    else break;
  }
  if (!start) return 0;
  return Math.max(1, Math.round(minutesBetween(start, readings[readings.length - 1].ts)));
}

/**
 * Evaluate readings (sorted oldest → newest).
 * @returns {{state:'OK'|'WATCH'|'EXCURSION', severity, temperature, slope, minutesAbove, timeToBreachMin, doorOpens}}
 */
function evaluate(readings, { minTemp = 2, maxTemp = 8 } = {}) {
  if (!readings.length) {
    return { state: 'OK', severity: null, temperature: null, slope: 0, minutesAbove: 0, timeToBreachMin: null, doorOpens: 0 };
  }

  const latest = readings[readings.length - 1];
  const windowStart = new Date(new Date(latest.ts).getTime() - 60 * 60000);
  const window = readings.filter((r) => new Date(r.ts) >= windowStart);
  const temperature = Number(latest.temperature);
  const slope = slopePerHour(window);
  const minutesAbove = minutesAboveLimit(readings, maxTemp);
  const doorOpens = window.filter((r) => r.doorOpen).length;

  // Exposure is consumed faster the further above the limit the load is.
  const burnRate = Math.max(1, 1 + (temperature - maxTemp) * 0.35);
  const timeToBreachMin = temperature > maxTemp
    ? Math.max(0, Math.round(EXPOSURE_BUDGET_MIN - minutesAbove * burnRate))
    : null;

  if (temperature > maxTemp || temperature < minTemp) {
    const severity = temperature >= maxTemp + 3 || (timeToBreachMin !== null && timeToBreachMin < 45)
      ? 'CRITICAL'
      : 'HIGH';
    return { state: 'EXCURSION', severity, temperature, slope, minutesAbove, timeToBreachMin, doorOpens };
  }

  // Predictive watch: still in range, but projected to cross the limit within 60 minutes.
  const projected = temperature + slope * 1;
  if (slope > 0.4 && projected > maxTemp) {
    return { state: 'WATCH', severity: 'WATCH', temperature, slope, minutesAbove, timeToBreachMin: null, doorOpens };
  }

  return { state: 'OK', severity: null, temperature, slope, minutesAbove, timeToBreachMin: null, doorOpens };
}

module.exports = { evaluate, slopePerHour, minutesAboveLimit, EXPOSURE_BUDGET_MIN };
