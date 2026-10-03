#!/usr/bin/env node
/**
 * Reefer IoT simulator — stands in for the telematics gateway.
 *
 * Sends one reading per shipment every INTERVAL seconds to the CAP
 * `ingestReading` action, which publishes it on Event Mesh
 * (topic intelliops/coldchain/reefer/reading).
 *
 *   node feeds/reefer-simulator.js                  # steady readings
 *   node feeds/reefer-simulator.js --heat CN-24018  # ramp one reefer past 8 °C
 *
 * In production the IoT gateway / SAP Integration Suite publishes straight to
 * Event Mesh and this script is not needed.
 */
const CAP_URL = process.env.CAP_URL || 'http://localhost:4004';
const INTERVAL = Number(process.env.INTERVAL || 10);
const AUTH = process.env.CAP_AUTH; // e.g. "Bearer <token>" when calling BTP
const heatIndex = process.argv.indexOf('--heat');
const heated = heatIndex > -1 ? process.argv[heatIndex + 1] : null;

const state = {
  'CN-24018': 5.8,
  'CN-24011': 5.1,
  'CN-24025': 5.0,
  'CN-24014': 4.3,
  'CN-24027': 4.6,
  'CN-24029': 3.9,
};

async function send(shipment, temperature) {
  const res = await fetch(`${CAP_URL}/odata/v4/coldchain/ingestReading`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(AUTH ? { Authorization: AUTH } : {}) },
    body: JSON.stringify({ shipment, temperature: Number(temperature.toFixed(2)), humidity: Number((60 + Math.random() * 8).toFixed(1)), doorOpen: Math.random() < 0.03 }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

async function tick() {
  for (const shipment of Object.keys(state)) {
    const drift = shipment === heated ? 0.45 : (Math.random() - 0.5) * 0.2;
    state[shipment] = Math.max(2.5, state[shipment] + drift);
    try {
      await send(shipment, state[shipment]);
    } catch (err) {
      console.error(`[${shipment}] ${err.message}`);
    }
  }
  console.log(new Date().toISOString(), Object.entries(state).map(([k, v]) => `${k}=${v.toFixed(1)}°C`).join('  '));
}

console.log(`Sending reefer readings to ${CAP_URL} every ${INTERVAL}s${heated ? ` (heating ${heated})` : ''}`);
tick();
setInterval(tick, INTERVAL * 1000);
