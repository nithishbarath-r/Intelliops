const cds = require('@sap/cds');
const { settings } = require('./lib/config');
const rules = require('./lib/rules');
const s4 = require('./adapters/s4-pm');
const bpa = require('./adapters/bpa');
const aicore = require('./adapters/aicore');
const joule = require('./adapters/joule');

const LOG = cds.log('intelliops');
let seqCounter = Date.now() * 100;
const round2 = (v) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const RECOVERY_LABELS = {
  DIVERT_REICE: 'Divert + re-ice',
  QUARANTINE: 'Quarantine consignment',
  REALLOCATE_BUFFER: 'Reallocate buffer stock',
};

module.exports = class ColdChainService extends cds.ApplicationService {
  async init() {
    const db = cds.entities('intelliops.coldchain');
    this.db = db;
    this.cfg = settings();
    const topic = (name) => `${this.cfg.topicPrefix}/${name}`;
    this.topics = {
      reading: topic('reefer/reading'),
      weather: topic('weather/observation'),
      position: topic('vehicle/position'),
      excursion: topic('excursion/detected'),
      approved: topic('recovery/approved'),
    };

    // ---------------------------------------------------------------- Event Mesh
    this.messaging = await cds.connect.to('messaging');
    this.messaging.on(this.topics.reading, (msg) => this.processReading(msg.data));
    this.messaging.on(this.topics.weather, (msg) => this.processWeather(msg.data));
    this.messaging.on(this.topics.position, (msg) => this.processPosition(msg.data));

    // ---------------------------------------------------------------- ingestion
    this.on('ingestReading', async (req) => {
      const data = { ...req.data, ts: req.data.ts || new Date().toISOString(), source: 'integration-suite' };
      await this.publishEvent(this.topics.reading, data);
      return 'accepted';
    });

    this.on('ingestPosition', async (req) => {
      const data = { ...req.data, ts: req.data.ts || new Date().toISOString() };
      await this.messaging.emit(this.topics.position, data); // high-frequency: not logged per message
      return 'accepted';
    });

    this.on('ingestWeather', async (req) => {
      const data = { ...req.data, ts: req.data.ts || new Date().toISOString() };
      await this.publishEvent(this.topics.weather, data);
      return 'accepted';
    });

    // ---------------------------------------------------------------- cockpit
    this.on('simulateExcursion', (req) => this.doSimulate(req.data.shipment || 'CN-24018', req));
    this.on('approveRecovery', (req) => this.doApprove(req));
    this.on('ask', (req) => this.answer(req.data.question || ''));
    this.on('riskForecasts', () => this.computeForecasts());
    this.on('maintenanceDocument', (req) => this.doMaintenanceDocument(req.data.shipment || 'CN-24018'));
    this.on('pipelineStatus', () => this.doStatus());
    this.on('resetDemo', () => this.doReset());

    return super.init();
  }

  // ======================================================================= helpers

  async publishEvent(topic, data) {
    await this.messaging.emit(topic, data);
    await this.log('Event Mesh', topic, `Published ${topic.split('/').slice(-2).join(' ')} for ${data.shipment}`, null, data.shipment);
  }

  async log(service, topic, message, ref, shipment) {
    const entry = { seq: ++seqCounter, ts: new Date().toISOString(), service, topic, message: String(message).slice(0, 500), ref: ref ?? null, shipment: shipment ?? null };
    await INSERT.into(this.db.PipelineEvents).entries(entry);
    LOG.info(`[${service}] ${message}`);
    return entry;
  }

  async shipmentByNumber(number) {
    const { Shipments } = this.db;
    return SELECT.one.from(Shipments, (s) => {
      s`*`;
      s.asset((a) => a`*`);
      s.driver((d) => d`*`);
    }).where({ number });
  }

  async recentReadings(shipmentId, limit = 24) {
    const rows = await SELECT.from(this.db.SensorReadings).where({ shipment_ID: shipmentId }).orderBy('ts desc').limit(limit);
    return rows.reverse();
  }

  async latestWeather(shipmentId) {
    return SELECT.one.from(this.db.WeatherObservations).where({ shipment_ID: shipmentId }).orderBy('ts desc');
  }

  async features(shipment, evaluation) {
    const weather = await this.latestWeather(shipment.ID);
    return {
      temperature: evaluation.temperature ?? 5,
      slopePerHour: Number((evaluation.slope ?? 0).toFixed(3)),
      ambientTemp: weather ? Number(weather.airTemp) : 32,
      stationaryMin: shipment.status === 'Excursion' || evaluation.state === 'EXCURSION' ? 40 : 0,
      doorOpens1h: evaluation.doorOpens ?? 0,
      hoursRemaining: Number(shipment.hoursRemaining ?? 1),
      minutesAboveLimit: evaluation.minutesAbove ?? 0,
    };
  }

  // ======================================================================= pipeline

  /** Event Mesh subscriber: a reefer reading arrived. */
  async processReading(data) {
    const { SensorReadings, Shipments, Excursions } = this.db;
    const shipment = await this.shipmentByNumber(data.shipment);
    if (!shipment) {
      LOG.warn(`Reading for unknown shipment ${data.shipment}`);
      return;
    }

    await INSERT.into(SensorReadings).entries({
      shipment_ID: shipment.ID,
      asset_ID: shipment.asset_ID,
      ts: data.ts,
      temperature: round2(data.temperature),
      humidity: round2(data.humidity),
      doorOpen: !!data.doorOpen,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      source: data.source || 'iot',
    });
    await UPDATE(Shipments, shipment.ID).with({
      lastSeenAt: data.ts,
      ...(data.latitude != null ? { lastLatitude: data.latitude, lastLongitude: data.longitude } : {}),
    });
    await this.log('HANA Cloud', 'SensorReadings', `Stored reading ${Number(data.temperature).toFixed(1)}°C for ${shipment.number}`, null, shipment.number);

    const limits = { minTemp: Number(shipment.asset?.minTemp ?? 2), maxTemp: Number(shipment.asset?.maxTemp ?? 8) };
    const evaluation = rules.evaluate(await this.recentReadings(shipment.ID), limits);
    const open = await SELECT.one.from(Excursions).where({ shipment_ID: shipment.ID, status: 'Open' });

    if (evaluation.state === 'EXCURSION') {
      if (open) {
        await UPDATE(Excursions, open.ID).with({
          peakTemp: Math.max(Number(open.peakTemp), evaluation.temperature),
          slopePerHour: Number(evaluation.slope.toFixed(2)),
          minutesAbove: evaluation.minutesAbove,
          timeToBreachMin: evaluation.timeToBreachMin,
          severity: evaluation.severity,
        });
      } else {
        await this.handleExcursion(shipment, evaluation);
      }
    } else if (evaluation.state === 'WATCH' && shipment.status === 'InTransit') {
      await UPDATE(Shipments, shipment.ID).with({ status: 'Watch' });
      await this.log('Sensing Agent', null, `${shipment.number} projected to cross ${limits.maxTemp}°C within the hour — on watch`, null, shipment.number);
    }
  }

  /** Event Mesh subscriber: live GPS from the driver app / telematics. */
  async processPosition(data) {
    const shipment = await this.shipmentByNumber(data.shipment);
    if (!shipment || data.latitude == null || data.longitude == null) return;
    await INSERT.into(this.db.GpsPositions).entries({
      shipment_ID: shipment.ID,
      ts: data.ts,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy != null ? Math.round(data.accuracy) : null,
      speedKmh: round2(data.speedKmh),
      source: 'driver-app',
    });
    await UPDATE(this.db.Shipments, shipment.ID).with({ lastLatitude: data.latitude, lastLongitude: data.longitude, lastSeenAt: data.ts });
  }

  /** Event Mesh subscriber: outside-air weather from Integration Suite (Open-Meteo). */
  async processWeather(data) {
    const shipment = await this.shipmentByNumber(data.shipment);
    if (!shipment) return;
    await INSERT.into(this.db.WeatherObservations).entries({
      shipment_ID: shipment.ID,
      ts: data.ts,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      airTemp: round2(data.airTemp),
      humidity: round2(data.humidity),
      rainMm: round2(data.rainMm) ?? 0,
      source: 'open-meteo',
    });
    await this.log('HANA Cloud', 'WeatherObservations', `Stored outside air ${data.airTemp}°C near ${shipment.number}`, null, shipment.number);
  }

  /** Threshold breached → AI Core forecast → S/4HANA PM notification → BPA approval. */
  async handleExcursion(shipment, evaluation) {
    const { Excursions, Shipments, MaintenanceNotifications, RiskForecasts } = this.db;
    const excursion = {
      ID: cds.utils.uuid(),
      shipment_ID: shipment.ID,
      asset_ID: shipment.asset_ID,
      detectedAt: new Date().toISOString(),
      peakTemp: evaluation.temperature,
      slopePerHour: Number(evaluation.slope.toFixed(2)),
      minutesAbove: evaluation.minutesAbove,
      severity: evaluation.severity,
      status: 'Open',
      timeToBreachMin: evaluation.timeToBreachMin,
    };
    await INSERT.into(Excursions).entries(excursion);
    await UPDATE(Shipments, shipment.ID).with({ status: 'Excursion' });
    await this.log('Sensing Agent', null, `Excursion ${evaluation.severity} on ${shipment.number}: ${evaluation.temperature.toFixed(1)}°C, +${evaluation.slope.toFixed(1)}°C/h`, excursion.ID, shipment.number);
    await this.log('Scenario Agent', null, `Exposure budget leaves ${evaluation.timeToBreachMin} min until breach`, excursion.ID, shipment.number);

    // SAP AI Core
    const features = await this.features(shipment, evaluation);
    const risk = await aicore.forecast(features);
    excursion.riskProbability = risk.probability;
    await INSERT.into(RiskForecasts).entries({
      shipment_ID: shipment.ID,
      computedAt: new Date().toISOString(),
      horizonHours: 24,
      probability: risk.probability,
      timeToBreachMin: evaluation.timeToBreachMin,
      level: risk.level,
      features: JSON.stringify(features),
      model: risk.model,
      mode: risk.mode,
    });
    await this.log('AI Core', null, `24h excursion risk ${Math.round(risk.probability * 100)}% (${risk.level}) — ${risk.model}`, null, shipment.number);

    // S/4HANA Plant Maintenance
    let notification = null;
    try {
      notification = await s4.createNotification({ shipment, asset: shipment.asset, excursion });
      const notificationId = cds.utils.uuid();
      await INSERT.into(MaintenanceNotifications).entries({ ID: notificationId, ...notification });
      excursion.pmNotification_ID = notificationId;
      await this.log('S/4HANA PM', 'API_MAINTNOTIFICATION', `Notification ${notification.number} (${notification.type}, priority ${notification.priority}) created for equipment ${notification.equipment}`, notification.number, shipment.number);
    } catch (err) {
      LOG.error('S/4HANA notification failed', err);
      await this.log('S/4HANA PM', 'API_MAINTNOTIFICATION', `Notification failed: ${err.message}`, null, shipment.number);
    }

    // SAP Build Process Automation (human-in-the-loop)
    try {
      const wf = await bpa.startApproval({ shipment, excursion, notification });
      excursion.workflowInstance = wf.id;
      await this.log('Build Process Automation', 'workflow-instances', `Recovery approval started for ${shipment.number} — task sent to coordinator`, wf.id, shipment.number);
    } catch (err) {
      LOG.error('BPA start failed', err);
      await this.log('Build Process Automation', 'workflow-instances', `Approval start failed: ${err.message}`, null, shipment.number);
    }

    await UPDATE(Excursions, excursion.ID).with({
      riskProbability: excursion.riskProbability,
      pmNotification_ID: excursion.pmNotification_ID ?? null,
      workflowInstance: excursion.workflowInstance ?? null,
    });

    await this.messaging.emit(this.topics.excursion, {
      shipment: shipment.number,
      excursion: excursion.ID,
      temperature: evaluation.temperature,
      timeToBreachMin: evaluation.timeToBreachMin,
      pmNotification: notification?.number ?? null,
    });
    await this.log('Event Mesh', this.topics.excursion, `Excursion event broadcast to subscribers (driver app, Build Apps)`, excursion.ID, shipment.number);
    await this.log('Compliance Agent', null, 'Automatic product disposition blocked — human approval required', excursion.ID, shipment.number);
    return excursion;
  }

  async doSimulate(number, req) {
    const shipment = await this.shipmentByNumber(number);
    if (!shipment) return req.reject(404, `Unknown shipment ${number}`);

    const startedAt = new Date(Date.now() - 1000).toISOString();
    const now = Date.now();
    const profile = [6.2, 7.1, 7.9, 8.3, 8.8, 9.2];
    for (let i = 0; i < profile.length; i += 1) {
      await this.publishEvent(this.topics.reading, {
        shipment: number,
        temperature: profile[i],
        humidity: 64,
        doorOpen: i === 3,
        latitude: shipment.lastLatitude,
        longitude: shipment.lastLongitude,
        ts: new Date(now - (profile.length - 1 - i) * 5 * 60000).toISOString(),
        source: 'simulator',
      });
    }

    const excursion = await SELECT.one.from(this.db.Excursions, (e) => {
      e`*`;
      e.pmNotification((n) => n`*`);
    }).where({ shipment_ID: shipment.ID, status: 'Open' });
    const steps = await SELECT.from(this.db.PipelineEvents).columns('ts', 'service', 'topic', 'message', 'ref').where({ ts: { '>=': startedAt }, shipment: number }).orderBy('seq');

    return {
      shipment: number,
      excursion: excursion?.ID ?? null,
      peakTemp: excursion?.peakTemp ?? null,
      timeToBreachMin: excursion?.timeToBreachMin ?? null,
      riskProbability: excursion?.riskProbability ?? null,
      pmNotification: excursion?.pmNotification?.number ?? null,
      workflowInstance: excursion?.workflowInstance ?? null,
      steps: compactSteps(steps),
    };
  }

  async doApprove(req) {
    const { shipment: number, option = 'DIVERT_REICE', approver } = req.data;
    const { Excursions, MaintenanceOrders, Shipments } = this.db;
    const shipment = await this.shipmentByNumber(number);
    if (!shipment) return req.reject(404, `Unknown shipment ${number}`);
    if (!RECOVERY_LABELS[option]) return req.reject(400, `Unknown recovery option ${option}`);

    const excursion = await SELECT.one.from(Excursions, (e) => {
      e`*`;
      e.pmNotification((n) => n`*`);
    }).where({ shipment_ID: shipment.ID, status: 'Open' });
    if (!excursion) return req.reject(409, `No open excursion for ${number}. Simulate or wait for a temperature event first.`);

    const startedAt = new Date(Date.now() - 1000).toISOString();
    const who = approver || req.user?.id || 'coordinator';
    const label = RECOVERY_LABELS[option];

    const wf = await bpa.completeApproval({ instanceId: excursion.workflowInstance, option, approver: who });
    await this.log('Build Process Automation', 'task-instances', `Approval task completed by ${who}: ${label}`, wf.id, number);

    let order = null;
    if (excursion.pmNotification) {
      try {
        order = await s4.createOrder({ notification: excursion.pmNotification, asset: shipment.asset, option: label });
        const orderId = cds.utils.uuid();
        await INSERT.into(MaintenanceOrders).entries({ ID: orderId, ...order });
        excursion.pmOrder_ID = orderId;
        await this.log('S/4HANA PM', 'API_MAINTENANCEORDER', `Order ${order.number} (${order.type}) created from notification ${order.notification}`, order.number, number);
      } catch (err) {
        LOG.error('S/4HANA order failed', err);
        await this.log('S/4HANA PM', 'API_MAINTENANCEORDER', `Order failed: ${err.message}`, null, number);
      }
    }

    await UPDATE(Excursions, excursion.ID).with({
      status: 'Approved',
      recoveryOption: option,
      approvedBy: who,
      approvedAt: new Date().toISOString(),
      pmOrder_ID: excursion.pmOrder_ID ?? null,
    });
    await UPDATE(Shipments, shipment.ID).with({ status: 'Watch' });

    await this.messaging.emit(this.topics.approved, { shipment: number, option, instruction: label, approver: who });
    await this.log('Event Mesh', this.topics.approved, 'Recovery instruction broadcast to the driver app', null, number);

    const steps = await SELECT.from(this.db.PipelineEvents).columns('ts', 'service', 'topic', 'message', 'ref').where({ ts: { '>=': startedAt }, shipment: number }).orderBy('seq');
    return {
      shipment: number,
      option,
      status: 'Approved',
      pmNotification: excursion.pmNotification?.number ?? null,
      pmOrder: order?.number ?? null,
      workflowInstance: excursion.workflowInstance ?? null,
      steps: compactSteps(steps),
    };
  }

  // ======================================================================= queries

  async computeForecasts() {
    const { Shipments, RiskForecasts } = this.db;
    const shipments = await SELECT.from(Shipments, (s) => {
      s`*`;
      s.asset((a) => a`*`);
      s.driver((d) => d`*`);
    }).where({ status: { '!=': 'Delivered' } });

    const out = [];
    for (const shipment of shipments) {
      const readings = await this.recentReadings(shipment.ID);
      const evaluation = rules.evaluate(readings, { minTemp: Number(shipment.asset?.minTemp ?? 2), maxTemp: Number(shipment.asset?.maxTemp ?? 8) });
      const features = await this.features(shipment, evaluation);
      if (shipment.status === 'Silent') features.stationaryMin = Math.max(features.stationaryMin, 30);
      const risk = await aicore.forecast(features);
      await INSERT.into(RiskForecasts).entries({
        shipment_ID: shipment.ID,
        computedAt: new Date().toISOString(),
        horizonHours: 24,
        probability: risk.probability,
        timeToBreachMin: evaluation.timeToBreachMin,
        level: risk.level,
        features: JSON.stringify(features),
        model: risk.model,
        mode: risk.mode,
      });
      out.push({
        shipment: shipment.number,
        driver: shipment.driver?.name ?? 'Depot pool',
        route: `${shipment.origin} → ${shipment.destination}`,
        probability: risk.probability,
        level: risk.level,
        timeToBreachMin: evaluation.timeToBreachMin,
        temperature: evaluation.temperature,
        status: shipment.status,
        mode: risk.mode,
      });
    }
    return out.sort((a, b) => b.probability - a.probability);
  }

  async answer(question) {
    const forecasts = await this.computeForecasts();
    const notifications = await SELECT.from(this.db.Excursions, (e) => {
      e.shipment((s) => s.number);
      e.pmNotification((n) => {
        n.number;
        n.equipment;
      });
    }).where({ pmNotification_ID: { '!=': null } });
    const openExcursions = (await SELECT.from(this.db.Excursions).where({ status: 'Open' })).length;
    const snapshot = {
      forecasts,
      notifications: notifications.map((n) => ({ shipment: n.shipment?.number, number: n.pmNotification?.number, equipment: n.pmNotification?.equipment })),
      openExcursions,
    };
    const result = await joule.ask(question, snapshot);
    await this.log('Joule', null, `Q: ${question.slice(0, 120)}`, null, null);
    return result;
  }

  async doMaintenanceDocument(number) {
    const shipment = await this.shipmentByNumber(number);
    if (!shipment) return null;
    const excursion = await SELECT.one.from(this.db.Excursions, (e) => {
      e`*`;
      e.pmNotification((n) => n`*`);
      e.pmOrder((o) => o`*`);
    }).where({ shipment_ID: shipment.ID }).orderBy('detectedAt desc');
    const n = excursion?.pmNotification;
    if (!n) return null;
    return {
      shipment: number,
      number: n.number,
      type: n.type,
      priority: n.priority,
      equipment: n.equipment,
      functionalLocation: n.functionalLocation,
      description: n.description,
      status: n.status,
      orderNumber: excursion.pmOrder?.number ?? null,
      orderType: excursion.pmOrder?.type ?? null,
      mode: n.mode,
    };
  }

  async doStatus() {
    const { SensorReadings, Excursions, MaintenanceNotifications, MaintenanceOrders, PipelineEvents } = this.db;
    const count = async (entity) => (await SELECT.one.from(entity).columns('count(*) as n')).n;
    const dbKind = cds.env.requires.db?.kind;
    const msgKind = cds.env.requires.messaging?.kind;
    const cfg = this.cfg;
    const services = [
      { service: 'HANA Cloud', mode: dbKind === 'hana' ? 'live' : 'mock', detail: dbKind === 'hana' ? 'HDI container' : `${dbKind} (local stand-in)` },
      { service: 'Event Mesh', mode: /enterprise-messaging/.test(msgKind) ? 'live' : 'mock', detail: msgKind },
      { service: 'AI Core', mode: cfg.aicore.mode === 'live' && cfg.aicore.deploymentId ? 'live' : 'mock', detail: cfg.aicore.deploymentId || 'local logistic model' },
      { service: 'S/4HANA PM', mode: cfg.s4.mode, detail: `destination ${cfg.s4.destination}` },
      { service: 'Build Process Automation', mode: cfg.bpa.mode, detail: cfg.bpa.definitionId },
      { service: 'Joule', mode: cfg.joule.mode === 'live' && cfg.joule.deploymentId ? 'live' : 'mock', detail: 'ask action / generative AI hub' },
    ];
    const events = await SELECT.from(PipelineEvents).columns('ts', 'service', 'topic', 'message', 'ref').orderBy('seq desc').limit(25);
    return {
      services,
      readings: await count(SensorReadings),
      excursions: await count(Excursions),
      notifications: await count(MaintenanceNotifications),
      orders: await count(MaintenanceOrders),
      events,
    };
  }

  async doReset() {
    const d = this.db;
    await DELETE.from(d.Excursions);
    await DELETE.from(d.MaintenanceOrders);
    await DELETE.from(d.MaintenanceNotifications);
    await DELETE.from(d.RiskForecasts);
    await DELETE.from(d.PipelineEvents);
    await DELETE.from(d.WeatherObservations);
    await DELETE.from(d.GpsPositions);
    await DELETE.from(d.SensorReadings).where({ source: { '!=': 'seed' } });
    const shipments = await SELECT.from(d.Shipments).columns('ID', 'baselineStatus');
    for (const s of shipments) await UPDATE(d.Shipments, s.ID).with({ status: s.baselineStatus });
    return 'reset';
  }
};

/** Collapse the per-reading Event Mesh/HANA noise into one readable pipeline step. */
function compactSteps(steps) {
  const isNoise = (s) => (s.service === 'Event Mesh' && /reefer reading/.test(s.message)) || (s.service === 'HANA Cloud' && /Stored reading/.test(s.message));
  const readings = steps.filter((s) => s.service === 'HANA Cloud' && /Stored reading/.test(s.message)).length;
  const firstNoise = steps.find(isNoise);
  const out = steps.filter((s) => !isNoise(s));
  if (readings) {
    out.unshift({
      ts: firstNoise?.ts ?? new Date().toISOString(),
      service: 'Event Mesh → HANA Cloud',
      topic: 'reefer/reading',
      message: `${readings} reefer readings published on Event Mesh and stored as time series`,
      ref: null,
    });
  }
  return out;
}
