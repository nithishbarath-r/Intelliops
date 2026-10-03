const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const rules = require('../srv/lib/rules');
const { predict } = require('../srv/lib/risk-model');
const { mockAnswer } = require('../srv/adapters/joule');

const { GET, POST } = cds.test(__dirname + '/..');
const base = '/odata/v4/coldchain';

describe('rules — Sensing & Scenario agent', () => {
  const at = (min, t) => ({ ts: new Date(Date.UTC(2026, 8, 27, 11, min)).toISOString(), temperature: t });

  it('flags an excursion above 8°C and estimates time to breach', () => {
    const r = rules.evaluate([at(0, 6.2), at(5, 7.1), at(10, 7.9), at(15, 8.3), at(20, 8.8), at(25, 9.2)]);
    assert.equal(r.state, 'EXCURSION');
    assert.equal(r.minutesAbove, 10);
    assert.ok(r.slope > 5, 'slope should be steep');
    assert.ok(r.timeToBreachMin > 100 && r.timeToBreachMin < 150);
  });

  it('puts a rising but in-range load on watch', () => {
    const r = rules.evaluate([at(0, 5.8), at(10, 6.4), at(20, 7.0), at(30, 7.5)]);
    assert.equal(r.state, 'WATCH');
  });

  it('keeps a stable load OK', () => {
    const r = rules.evaluate([at(0, 4.5), at(10, 4.6), at(20, 4.5)]);
    assert.equal(r.state, 'OK');
  });
});

describe('risk model — AI Core contract', () => {
  it('scores a hot, rising, stationary reefer as HIGH', () => {
    const r = predict({ temperature: 9.2, slopePerHour: 7, ambientTemp: 34, stationaryMin: 40, doorOpens1h: 1, hoursRemaining: 2.4, minutesAboveLimit: 10 });
    assert.equal(r.level, 'HIGH');
  });
  it('scores a cold, stable reefer as LOW', () => {
    const r = predict({ temperature: 4, slopePerHour: 0, ambientTemp: 30, stationaryMin: 0, doorOpens1h: 0, hoursRemaining: 0.5, minutesAboveLimit: 0 });
    assert.equal(r.level, 'LOW');
  });
});

describe('Joule mock intents', () => {
  const snapshot = {
    forecasts: [
      { shipment: 'CN-24018', route: 'Chennai → Madurai', driver: 'Raghul', probability: 0.97, level: 'HIGH', timeToBreachMin: 130, temperature: 9.2 },
      { shipment: 'CN-24029', route: 'Madurai → PHC', driver: 'Sabarish', probability: 0.02, level: 'LOW', timeToBreachMin: null, temperature: 3.9 },
    ],
    notifications: [{ shipment: 'CN-24018', number: '10004701', equipment: '10004521' }],
    openExcursions: 1,
  };
  it('answers which shipments are at risk', () => {
    const a = mockAnswer('Which shipments are at risk today?', snapshot);
    assert.deepEqual(a.shipments, ['CN-24018']);
  });
  it('answers about a specific shipment', () => {
    const a = mockAnswer('status of cn-24018', snapshot);
    assert.match(a.answer, /10004701/);
  });
});

describe('ColdChainService — end-to-end SAP pipeline (mock adapters)', () => {
  before(async () => {
    await POST(`${base}/resetDemo`, {});
  });

  it('serves seeded shipments from HANA (SQLite in dev)', async () => {
    const { data } = await GET(`${base}/Shipments?$select=number,status&$orderby=number`);
    assert.equal(data.value.length, 6);
    assert.ok(data.value.find((s) => s.number === 'CN-24018'));
  });

  it('simulateExcursion runs Event Mesh → HANA → rules → AI Core → S/4 PM → BPA', async () => {
    const { data } = await POST(`${base}/simulateExcursion`, { shipment: 'CN-24018' });
    assert.ok(data.excursion, 'excursion created');
    assert.equal(Number(data.peakTemp), 9.2);
    assert.match(data.pmNotification, /^\d+$/);
    assert.match(data.workflowInstance, /^mock-wf-/);
    const services = data.steps.map((s) => s.service);
    for (const s of ['Event Mesh → HANA Cloud', 'Sensing Agent', 'AI Core', 'S/4HANA PM', 'Build Process Automation', 'Compliance Agent']) {
      assert.ok(services.includes(s), `missing step ${s}: ${services.join(', ')}`);
    }
  });

  it('exposes the S/4HANA maintenance notification for the incident', async () => {
    const { data } = await GET(`${base}/maintenanceDocument(shipment='CN-24018')`);
    assert.equal(data.type, 'M2');
    assert.equal(data.equipment, '10004521');
  });

  it('ranks CN-24018 as the highest 24h risk', async () => {
    const { data } = await GET(`${base}/riskForecasts()`);
    assert.equal(data.value[0].shipment, 'CN-24018');
    assert.equal(data.value[0].level, 'HIGH');
  });

  it('answers a natural-language question', async () => {
    const { data } = await POST(`${base}/ask`, { question: 'Which shipments are at risk today?' });
    assert.ok(data.shipments.includes('CN-24018'));
  });

  it('approveRecovery completes the BPA task and creates a maintenance order', async () => {
    const { data } = await POST(`${base}/approveRecovery`, { shipment: 'CN-24018', option: 'DIVERT_REICE', approver: 'Meera Raghavan' });
    assert.equal(data.status, 'Approved');
    assert.match(data.pmOrder, /^\d+$/);
    const doc = await GET(`${base}/maintenanceDocument(shipment='CN-24018')`);
    assert.equal(doc.data.orderNumber, data.pmOrder);
  });

  it('rejects a second approval when nothing is open', async () => {
    await assert.rejects(POST(`${base}/approveRecovery`, { shipment: 'CN-24018', option: 'DIVERT_REICE' }), /409|No open excursion/);
  });

  it('ingestReading publishes through Event Mesh and stores the time series', async () => {
    await POST(`${base}/ingestReading`, { shipment: 'CN-24029', temperature: 4.137, humidity: 60.123456789, doorOpen: false });
    const { data } = await GET(`${base}/SensorReadings?$filter=source eq 'integration-suite'`);
    assert.ok(data.value.length >= 1);
  });

  it('ingestPosition stores the live GPS trail and moves the shipment', async () => {
    await POST(`${base}/ingestPosition`, { shipment: 'CN-24018', latitude: 10.1285, longitude: 78.3905, accuracy: 9.6, speedKmh: 61.234 });
    await POST(`${base}/ingestPosition`, { shipment: 'CN-24018', latitude: 10.1255, longitude: 78.389, accuracy: 8, speedKmh: 62 });
    const { data } = await GET(`${base}/GpsPositions?$orderby=ts desc`);
    assert.equal(data.value.length, 2);
    const s = await GET(`${base}/Shipments?$filter=number eq 'CN-24018'&$select=lastLatitude`);
    assert.equal(s.data.value[0].lastLatitude, 10.1255);
  });

  it('reports pipeline status for every SAP service', async () => {
    const { data } = await GET(`${base}/pipelineStatus()`);
    const names = data.services.map((s) => s.service);
    assert.deepEqual(names, ['HANA Cloud', 'Event Mesh', 'AI Core', 'S/4HANA PM', 'Build Process Automation', 'Joule']);
    assert.ok(data.notifications >= 1 && data.orders >= 1);
  });
});
