/**
 * S/4HANA Plant Maintenance adapter.
 *
 * On a temperature breach the reefer unit (an S/4 equipment) gets a
 * malfunction notification (API_MAINTNOTIFICATION). When the coordinator
 * approves a recovery, a maintenance / inspection order is created against
 * that notification (API_MAINTENANCEORDER).
 *
 * Live mode calls S/4HANA through the BTP destination `S4HANA_PM`
 * (Cloud SDK fetches the CSRF token automatically). Field names follow the
 * standard released APIs — check them against your system's $metadata, as
 * mandatory fields (planning plant, work centre, catalog codes) vary by config.
 */
const { settings } = require('../lib/config');
const { callDestination } = require('../lib/http');

let mockNotificationCounter = 10004700;
let mockOrderCounter = 4000120;

async function createNotification({ shipment, asset, excursion }) {
  const cfg = settings().s4;
  const description = `Reefer excursion ${shipment.number} ${Number(excursion.peakTemp).toFixed(1)}C`.slice(0, 40);
  const longText =
    `IntelliOps detected a cold-chain excursion on ${shipment.number} (${shipment.origin} -> ${shipment.destination}). ` +
    `Reefer ${asset.code} at ${excursion.peakTemp} C, limit ${asset.maxTemp} C, rising ${excursion.slopePerHour} C/h. ` +
    `Estimated time to breach: ${excursion.timeToBreachMin} min. ${shipment.doses} doses affected.`;

  const base = {
    type: cfg.notificationType,
    priority: cfg.priority,
    equipment: asset.s4Equipment,
    functionalLocation: asset.s4FunctionalLocation,
    description,
    longText,
  };

  if (cfg.mode !== 'live') {
    mockNotificationCounter += 1;
    return { ...base, number: String(mockNotificationCounter), status: 'OSNO', mode: 'mock' };
  }

  const data = await callDestination(cfg.destination, {
    method: 'post',
    url: '/sap/opu/odata/sap/API_MAINTNOTIFICATION/MaintenanceNotification',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    data: {
      NotificationText: description,
      NotificationType: cfg.notificationType,
      MaintPriority: cfg.priority,
      TechnicalObject: asset.s4Equipment,
      TechObjIsEquipOrFuncnlLoc: 'EAMS_EQUI',
      MaintNotifLongTextForEdit: longText,
      ...(asset.s4Plant ? { MaintenancePlanningPlant: asset.s4Plant } : {}),
    },
  });
  const created = data?.d ?? data;
  return { ...base, number: created.MaintenanceNotification, status: created.NotificationProcessingPhase ?? 'OSNO', mode: 'live' };
}

async function createOrder({ notification, asset, option }) {
  const cfg = settings().s4;
  const description = `Inspect reefer after ${option}`.slice(0, 40);

  if (cfg.mode !== 'live') {
    mockOrderCounter += 1;
    return { number: String(mockOrderCounter), type: cfg.orderType, description, notification: notification.number, equipment: asset.s4Equipment, status: 'CRTD', mode: 'mock' };
  }

  const data = await callDestination(cfg.destination, {
    method: 'post',
    url: '/sap/opu/odata/sap/API_MAINTENANCEORDER/MaintenanceOrder',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    data: {
      MaintenanceOrderType: cfg.orderType,
      MaintenanceOrderDesc: description,
      MaintenanceNotification: notification.number,
      Equipment: asset.s4Equipment,
      ...(asset.s4Plant ? { MaintenancePlanningPlant: asset.s4Plant, MaintenancePlant: asset.s4Plant } : {}),
    },
  });
  const created = data?.d ?? data;
  return { number: created.MaintenanceOrder, type: cfg.orderType, description, notification: notification.number, equipment: asset.s4Equipment, status: 'CRTD', mode: 'live' };
}

module.exports = { createNotification, createOrder };
