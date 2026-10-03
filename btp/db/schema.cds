namespace intelliops.coldchain;

using {
  cuid,
  managed
} from '@sap/cds/common';

// ---------------------------------------------------------------------------
// Master data — mirrors the drivers, vehicles and consignments in the app.
// Each reefer unit is an S/4HANA Plant Maintenance equipment.
// ---------------------------------------------------------------------------

entity Drivers : cuid {
  code     : String(20);  // matches the app's local ids (driver-1 … driver-5)
  name     : String(80);
  initials : String(4);
  phone    : String(20);
  vehicle  : String(20);
  type     : String(60);
}

entity Assets : cuid {
  code               : String(30);     // REEFER-4521
  kind               : String(20) enum {
    Reefer;
    ColdRoom;
  };
  description        : String(120);
  vehicle            : String(20);
  s4Equipment        : String(18);     // S/4HANA PM equipment number
  s4FunctionalLocation : String(40);
  s4Plant            : String(4);
  minTemp            : Decimal(4, 1) default 2;
  maxTemp            : Decimal(4, 1) default 8;
}

entity Shipments : cuid, managed {
  number         : String(20);          // CN-24018
  origin         : String(80);
  destination    : String(80);
  product        : String(80);
  doses          : Integer;
  children       : Integer;
  facilities     : Integer;
  status         : String(20) enum {
    InTransit;
    Watch;
    Excursion;
    Silent;
    Delivered;
  };
  baselineStatus : String(20);          // used by resetDemo()
  asset          : Association to Assets;
  driver         : Association to Drivers;
  routeKm        : Integer;
  hoursRemaining : Decimal(5, 2);
  lastLatitude   : Double;
  lastLongitude  : Double;
  lastSeenAt     : Timestamp;
}

// ---------------------------------------------------------------------------
// Time-series data (HANA Cloud column tables in production)
// ---------------------------------------------------------------------------

entity SensorReadings : cuid {
  shipment    : Association to Shipments;
  asset       : Association to Assets;
  ts          : Timestamp;
  temperature : Decimal(5, 2);
  humidity    : Decimal(5, 2);
  doorOpen    : Boolean default false;
  latitude    : Double;
  longitude   : Double;
  source      : String(30);             // seed | simulator | iot | integration-suite
}

entity GpsPositions : cuid {
  shipment  : Association to Shipments;
  ts        : Timestamp;
  latitude  : Double;
  longitude : Double;
  accuracy  : Integer;                  // metres
  speedKmh  : Decimal(6, 2);
  source    : String(30);               // driver-app | telematics
}

entity WeatherObservations : cuid {
  shipment  : Association to Shipments;
  ts        : Timestamp;
  latitude  : Double;
  longitude : Double;
  airTemp   : Decimal(5, 2);
  humidity  : Decimal(5, 2);
  rainMm    : Decimal(6, 2);
  source    : String(30);               // open-meteo via Integration Suite
}

// ---------------------------------------------------------------------------
// Detection, prediction and follow-up documents
// ---------------------------------------------------------------------------

entity Excursions : cuid, managed {
  shipment         : Association to Shipments;
  asset            : Association to Assets;
  detectedAt       : Timestamp;
  peakTemp         : Decimal(5, 2);
  slopePerHour     : Decimal(6, 2);
  minutesAbove     : Integer;
  severity         : String(10) enum {
    WATCH;
    HIGH;
    CRITICAL;
  };
  status           : String(20) enum {
    Open;
    Approved;
    Resolved;
  };
  timeToBreachMin  : Integer;
  riskProbability  : Decimal(5, 4);
  recoveryOption   : String(40);
  approvedBy       : String(80);
  approvedAt       : Timestamp;
  pmNotification   : Association to MaintenanceNotifications;
  pmOrder          : Association to MaintenanceOrders;
  workflowInstance : String(80);        // SAP Build Process Automation instance id
}

entity MaintenanceNotifications : cuid, managed {
  number             : String(12);      // S/4HANA notification number
  type               : String(2);       // M2 = malfunction report
  priority           : String(1);       // 1 = very high
  equipment          : String(18);
  functionalLocation : String(40);
  description        : String(40);
  longText           : LargeString;
  status             : String(20);
  mode               : String(10);      // mock | live
}

entity MaintenanceOrders : cuid, managed {
  number       : String(12);
  type         : String(4);             // PM01 / PM03 per your S/4 config
  description  : String(40);
  notification : String(12);
  equipment    : String(18);
  status       : String(20);
  mode         : String(10);
}

entity RiskForecasts : cuid {
  shipment         : Association to Shipments;
  computedAt       : Timestamp;
  horizonHours     : Integer default 24;
  probability      : Decimal(5, 4);
  timeToBreachMin  : Integer;
  level            : String(10);        // LOW | MEDIUM | HIGH
  features         : LargeString;       // JSON of model inputs
  model            : String(60);
  mode             : String(10);        // mock | live (SAP AI Core)
}

// Audit trail of everything that moved through the SAP stack.
entity PipelineEvents : cuid {
  seq      : Int64;                     // strict ordering within the same millisecond
  ts       : Timestamp;
  service  : String(40);                // Event Mesh | HANA Cloud | AI Core | S/4HANA PM | Build Process Automation | Integration Suite | Joule
  topic    : String(120);
  message  : String(500);
  ref      : String(60);
  shipment : String(20);
}

// ---------------------------------------------------------------------------
// Analytics views — consumed by SAP Analytics Cloud (live connection)
// ---------------------------------------------------------------------------

@Aggregation.ApplySupported.PropertyRestrictions: true
view ShipmentTemperatureStats as
  select from SensorReadings {
    key shipment.ID     as shipmentID,
        shipment.number as shipmentNumber,
        count(*)        as readings    : Integer,
        min(temperature) as minTemp    : Decimal(5, 2),
        max(temperature) as maxTemp    : Decimal(5, 2),
        avg(temperature) as avgTemp    : Decimal(5, 2)
  }
  group by
    shipment.ID,
    shipment.number;
