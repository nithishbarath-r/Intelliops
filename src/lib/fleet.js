// Fleet data shared by the demo database, the Supabase seed script and the
// live map: who drives which trip, and where places are.

import { driverIdByLocalId, drivers, initialsOf, shipmentByDriver } from "../data.js";

export const INCIDENT_SHIPMENT = "CN-24018";

export const PLACES = {
  Chennai: { lat: 13.0827, lon: 80.2707 },
  "Chennai State Store": { lat: 13.0827, lon: 80.2707 },
  Madurai: { lat: 9.9252, lon: 78.1198 },
  "Madurai District Store": { lat: 9.9252, lon: 78.1198 },
  "Madurai store": { lat: 9.9252, lon: 78.1198 },
  Villupuram: { lat: 11.9401, lon: 79.4861 },
  Salem: { lat: 11.6643, lon: 78.146 },
  Erode: { lat: 11.341, lon: 77.7172 },
  Tiruchirappalli: { lat: 10.7905, lon: 78.7047 },
  Sivaganga: { lat: 9.8433, lon: 78.4809 },
  Melur: { lat: 10.032, lon: 78.338 },
  "PHC Tirumangalam": { lat: 9.8216, lon: 77.9869 },
};

export function placeCoords(name) {
  return PLACES[name] ?? null;
}

/** Each driver's own trip when they are not carrying the CN-24018 incident. */
export const DRIVER_TRIPS = {
  "driver-1": { number: "CN-24031", origin: "Chennai", destination: "Villupuram", position: { lat: 12.4521, lon: 79.8113 }, temperature: 4.8 },
  "driver-2": { number: "CN-24011", origin: "Salem", destination: "Erode", position: { lat: 11.4502, lon: 77.8805 }, temperature: 5.1 },
  "driver-3": { number: "CN-24025", origin: "Tiruchirappalli", destination: "Sivaganga", position: { lat: 10.2901, lon: 78.5012 }, temperature: 5.0 },
  "driver-4": { number: "CN-24027", origin: "Madurai", destination: "Melur", position: { lat: 9.9805, lon: 78.2105 }, temperature: 4.6 },
  "driver-5": { number: "CN-24029", origin: "Madurai store", destination: "PHC Tirumangalam", position: { lat: 9.8605, lon: 78.0201 }, temperature: 3.9 },
};

export const INCIDENT_TRIP = {
  number: INCIDENT_SHIPMENT,
  origin: "Chennai",
  destination: "Madurai",
  position: { lat: 10.1285, lon: 78.3905 },
  temperature: 9.2,
};

export function demoEmail(driver) {
  return `${driver.name.split(" ")[0].toLowerCase()}@intelliops.demo`;
}

/** Turn a Supabase driver profile into the driver shape the screens use. */
export function driverFromProfile(profile) {
  const local = drivers.find((d) => d.vehicle === profile?.vehicle_number || driverIdByLocalId[d.id] === profile?.id);
  if (local) return local;
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.full_name ?? "Driver",
    initials: initialsOf(profile.full_name ?? "Driver"),
    vehicle: profile.vehicle_number ?? "—",
    type: "Reefer vehicle",
    phone: profile.phone ?? "",
    location: "On route",
  };
}

/**
 * Find who carries the incident and which rows to write to, in any Supabase
 * project (no hard-coded ids needed):
 *   1. the shipment numbered CN-24018 and its driver, else
 *   2. the date-assigned driver, matched by vehicle number, else
 *   3. the original hard-coded ids from the first prototype.
 */
export async function resolveIncident(supabase, fallbackDriver) {
  try {
    const { data: incident } = await supabase
      .from("shipments")
      .select("*")
      .eq("shipment_number", INCIDENT_SHIPMENT)
      .limit(1)
      .maybeSingle();

    if (incident?.driver_id) {
      const { data: profile } = await supabase.from("profiles").select("*").eq("id", incident.driver_id).maybeSingle();
      const driver = driverFromProfile(profile) ?? fallbackDriver;
      return { driver, driverId: incident.driver_id, shipmentId: incident.id, source: "incident-shipment" };
    }

    const { data: byVehicle } = await supabase
      .from("profiles")
      .select("*")
      .eq("vehicle_number", fallbackDriver.vehicle)
      .limit(1)
      .maybeSingle();

    if (byVehicle?.id) {
      const { data: ship } = await supabase.from("shipments").select("id").eq("driver_id", byVehicle.id).limit(1).maybeSingle();
      if (ship?.id) return { driver: fallbackDriver, driverId: byVehicle.id, shipmentId: ship.id, source: "vehicle-number" };
    }
  } catch (error) {
    console.warn("Incident lookup failed, using original ids:", error.message);
  }

  const driverId = driverIdByLocalId[fallbackDriver.id];
  return { driver: fallbackDriver, driverId, shipmentId: shipmentByDriver[driverId], source: "hard-coded" };
}
