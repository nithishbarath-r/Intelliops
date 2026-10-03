#!/usr/bin/env node
/**
 * Weather bridge — local stand-in for the SAP Integration Suite iFlow
 * described in btp/integration-suite/README.md.
 *
 * For each shipment's last known position it reads current outside-air
 * conditions from Open-Meteo (the same API the driver app already uses) and
 * pushes them to CAP `ingestWeather` → Event Mesh → HANA Cloud.
 *
 *   node feeds/weather-bridge.js          # every 10 minutes
 *   node feeds/weather-bridge.js --once
 */
const CAP_URL = process.env.CAP_URL || 'http://localhost:4004';
const AUTH = process.env.CAP_AUTH;
const EVERY_MIN = Number(process.env.EVERY_MIN || 10);
const headers = { 'Content-Type': 'application/json', ...(AUTH ? { Authorization: AUTH } : {}) };

async function run() {
  const res = await fetch(`${CAP_URL}/odata/v4/coldchain/Shipments?$select=number,lastLatitude,lastLongitude&$filter=status ne 'Delivered'`, { headers });
  const { value: shipments } = await res.json();

  for (const s of shipments) {
    if (s.lastLatitude == null) continue;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${s.lastLatitude}&longitude=${s.lastLongitude}&current=temperature_2m,relative_humidity_2m,precipitation&timezone=auto`;
      const w = await (await fetch(url)).json();
      await fetch(`${CAP_URL}/odata/v4/coldchain/ingestWeather`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          shipment: s.number,
          airTemp: w.current.temperature_2m,
          humidity: w.current.relative_humidity_2m,
          rainMm: w.current.precipitation ?? 0,
          latitude: s.lastLatitude,
          longitude: s.lastLongitude,
        }),
      });
      console.log(`${s.number}: ${w.current.temperature_2m}°C, ${w.current.relative_humidity_2m}%`);
    } catch (err) {
      console.error(`${s.number}: ${err.message}`);
    }
  }
}

run();
if (!process.argv.includes('--once')) setInterval(run, EVERY_MIN * 60000);
