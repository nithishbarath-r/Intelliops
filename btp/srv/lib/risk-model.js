/**
 * 24-hour excursion-risk model (mock mode).
 *
 * Same features and output contract as the model served on SAP AI Core
 * (btp/ai-core/serve.py). In mock mode this logistic function runs locally
 * with fixed coefficients; in live mode the AI Core deployment is called
 * instead (see adapters/aicore.js).
 */

const COEFFICIENTS = {
  intercept: -5.5,
  temperatureAbove6: 1.1,     // per °C above 6
  slopePerHour: 0.35,         // per °C/h
  ambientAbove30: 0.08,       // per °C of outside air above 30
  stationaryMin: 0.02,        // per minute stationary
  doorOpens1h: 0.35,          // per door-open event in the last hour
  hoursRemaining: 0.12,       // longer remaining trip = more exposure
  minutesAboveLimit: 0.03,
};

const MODEL_NAME = 'intelliops-excursion-risk-v1';

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

/**
 * @param {object} f features
 * @returns {{probability:number, level:'LOW'|'MEDIUM'|'HIGH'}}
 */
function predict(f) {
  const c = COEFFICIENTS;
  const z =
    c.intercept +
    c.temperatureAbove6 * ((f.temperature ?? 5) - 6) +
    c.slopePerHour * (f.slopePerHour ?? 0) +
    c.ambientAbove30 * ((f.ambientTemp ?? 30) - 30) +
    c.stationaryMin * (f.stationaryMin ?? 0) +
    c.doorOpens1h * (f.doorOpens1h ?? 0) +
    c.hoursRemaining * (f.hoursRemaining ?? 0) +
    c.minutesAboveLimit * (f.minutesAboveLimit ?? 0);

  const probability = Math.min(0.999, Math.max(0.001, sigmoid(z)));
  const level = probability >= 0.6 ? 'HIGH' : probability >= 0.25 ? 'MEDIUM' : 'LOW';
  return { probability: Number(probability.toFixed(4)), level };
}

module.exports = { predict, COEFFICIENTS, MODEL_NAME };
