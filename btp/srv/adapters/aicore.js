/**
 * SAP AI Core adapter — 24h excursion-risk prediction.
 *
 * Live mode calls the model deployed from btp/ai-core (KServe serving
 * template) through destination `AICORE`:
 *   POST /v2/inference/deployments/{deploymentId}/v1/predict
 * Mock mode runs the same logistic model locally (lib/risk-model.js).
 */
const { settings } = require('../lib/config');
const { callDestination } = require('../lib/http');
const { predict, MODEL_NAME } = require('../lib/risk-model');

async function forecast(features) {
  const cfg = settings().aicore;

  if (cfg.mode !== 'live' || !cfg.deploymentId) {
    return { ...predict(features), model: `${MODEL_NAME} (local)`, mode: 'mock' };
  }

  const data = await callDestination(cfg.destination, {
    method: 'post',
    url: `/v2/inference/deployments/${cfg.deploymentId}/v1/predict`,
    headers: { 'AI-Resource-Group': cfg.resourceGroup, 'Content-Type': 'application/json' },
    data: { instances: [features] },
  });
  const p = data.predictions?.[0] ?? data;
  return { probability: Number(p.probability), level: p.level, model: p.model ?? MODEL_NAME, mode: 'live' };
}

module.exports = { forecast };
