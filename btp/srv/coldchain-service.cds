using intelliops.coldchain as db from '../db/schema';

/**
 * IntelliOps Cold Chain Guardian — CAP service on SAP BTP.
 * Served as OData V4 at /odata/v4/coldchain
 */
@requires: 'authenticated-user'
service ColdChainService @(path: 'coldchain') {

  @readonly entity Drivers                  as projection on db.Drivers;
  @readonly entity Assets                   as projection on db.Assets;
  @readonly entity Shipments                as projection on db.Shipments;
  @readonly entity SensorReadings           as projection on db.SensorReadings;
  @readonly entity WeatherObservations      as projection on db.WeatherObservations;
  @readonly entity GpsPositions             as projection on db.GpsPositions;
  @readonly entity Excursions               as projection on db.Excursions;
  @readonly entity MaintenanceNotifications as projection on db.MaintenanceNotifications;
  @readonly entity MaintenanceOrders        as projection on db.MaintenanceOrders;
  @readonly entity RiskForecasts            as projection on db.RiskForecasts;
  @readonly entity PipelineEvents           as projection on db.PipelineEvents;
  @readonly entity ShipmentTemperatureStats as projection on db.ShipmentTemperatureStats;

  type PipelineStep {
    ts      : Timestamp;
    service : String;
    topic   : String;
    message : String;
    ref     : String;
  }

  type SimulationResult {
    shipment        : String;
    excursion       : UUID;
    peakTemp        : Decimal(5, 2);
    timeToBreachMin : Integer;
    riskProbability : Decimal(5, 4);
    pmNotification  : String;
    workflowInstance: String;
    steps           : many PipelineStep;
  }

  type Forecast {
    shipment        : String;
    driver          : String;
    route           : String;
    probability     : Decimal(5, 4);
    level           : String;
    timeToBreachMin : Integer;
    temperature     : Decimal(5, 2);
    mode            : String;
  }

  type Answer {
    answer    : String;
    shipments : many String;
    source    : String;      // mock rules | SAP AI Core (generative AI hub)
  }

  type ServiceStatus {
    service : String;
    mode    : String;         // mock | live
    detail  : String;
  }

  type Status {
    services   : many ServiceStatus;
    readings   : Integer;
    excursions : Integer;
    notifications : Integer;
    orders     : Integer;
    events     : many PipelineStep;
  }

  type Approval {
    shipment         : String;
    option           : String;
    status           : String;
    pmNotification   : String;
    pmOrder          : String;
    workflowInstance : String;
    steps            : many PipelineStep;
  }

  type PmDocument {
    shipment      : String;
    number        : String;
    type          : String;
    priority      : String;
    equipment     : String;
    functionalLocation : String;
    description   : String;
    status        : String;
    orderNumber   : String;
    orderType     : String;
    mode          : String;
  }

  // --- Ingestion (called by Integration Suite / IoT bridge; publishes to Event Mesh) ---
  action ingestReading(shipment : String, temperature : Double, humidity : Double,
                       doorOpen : Boolean, latitude : Double, longitude : Double, ts : Timestamp) returns String;
  action ingestPosition(shipment : String, latitude : Double, longitude : Double, accuracy : Integer,
                        speedKmh : Double, ts : Timestamp) returns String;
  action ingestWeather(shipment : String, airTemp : Double, humidity : Double,
                       rainMm : Double, latitude : Double, longitude : Double, ts : Timestamp) returns String;

  // --- Cockpit actions ---
  action simulateExcursion(shipment : String)                       returns SimulationResult;
  @(requires: 'Coordinator')
  action approveRecovery(shipment : String, option : String, approver : String) returns Approval;
  action ask(question : String)                                     returns Answer;
  action resetDemo()                                                returns String;

  function riskForecasts()                                          returns many Forecast;
  function maintenanceDocument(shipment : String)                   returns PmDocument;
  function pipelineStatus()                                         returns Status;
}
