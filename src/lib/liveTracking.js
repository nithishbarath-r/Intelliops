// Shared helpers for the live GPS map (driver + coordinator views).
// Everything here is free: browser Geolocation + OpenStreetMap tiles.
// No map API key is needed.

export const ORIGIN = { name: "Chennai", position: [13.0827, 80.2707] };
export const DESTINATION = { name: "Madurai", position: [9.9252, 78.1198] };

// Approximate highway corridor Chennai → Madurai (NH32 / NH38).
export const ROUTE = [
  [13.0827, 80.2707], // Chennai
  [12.9249, 80.1], // Tambaram
  [12.6921, 79.9707], // Chengalpattu
  [12.234, 79.655], // Tindivanam
  [11.9401, 79.4861], // Villupuram
  [11.69, 79.29], // Ulundurpet
  [11.2333, 78.8833], // Perambalur
  [10.7905, 78.7047], // Tiruchirappalli
  [10.602, 78.544], // Viralimalai
  [10.375, 78.42], // Thuvarankurichi
  [10.0321, 78.338], // Melur
  [9.9252, 78.1198], // Madurai
];

export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const toRad = (deg) => (deg * Math.PI) / 180;

export function distanceKm(a, b) {
  const R = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearingDeg(a, b) {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x =
    Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
    Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function compass(deg) {
  if (deg == null) return "--";
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

// Remaining road distance: from the closest route vertex ahead of the truck.
export function remainingKm(position) {
  if (!position) return null;
  let best = 0;
  let bestDist = Infinity;
  ROUTE.forEach((point, index) => {
    const d = distanceKm(position, point);
    if (d < bestDist) {
      bestDist = d;
      best = index;
    }
  });
  const next = Math.min(best + 1, ROUTE.length - 1);
  let total = distanceKm(position, ROUTE[next]);
  for (let i = next; i < ROUTE.length - 1; i += 1) {
    total += distanceKm(ROUTE[i], ROUTE[i + 1]);
  }
  // Far off the corridor (e.g. testing from home): fall back to straight line.
  if (bestDist > 60) return distanceKm(position, DESTINATION.position);
  return total;
}

// Speed (km/h) and heading from the last points of a trail.
export function motion(trail) {
  if (!trail || trail.length < 2) return { speed: null, heading: null };
  const last = trail[trail.length - 1];
  let prev = trail[trail.length - 2];
  for (let i = trail.length - 2; i >= 0; i -= 1) {
    prev = trail[i];
    if (last.t - trail[i].t >= 15000) break;
  }
  const hours = (last.t - prev.t) / 3600000;
  const km = distanceKm([prev.lat, prev.lng], [last.lat, last.lng]);
  return {
    speed: hours > 0 ? km / hours : null,
    heading: km > 0.005 ? bearingDeg([prev.lat, prev.lng], [last.lat, last.lng]) : null,
  };
}

export function trackingState(lastSeenValue, now = Date.now(), trackingStatus = null) {
  if (!lastSeenValue) return { status: "NOT_STARTED", ageInMinutes: null };
  if (trackingStatus === "PAUSED") {
    return {
      status: "PAUSED",
      ageInMinutes: Math.max(0, Math.floor((now - new Date(lastSeenValue).getTime()) / 60000)),
    };
  }
  const ageInMinutes = Math.max(0, Math.floor((now - new Date(lastSeenValue).getTime()) / 60000));
  if (ageInMinutes <= 2) return { status: "LIVE", ageInMinutes };
  if (ageInMinutes <= 10) return { status: "STALE", ageInMinutes };
  return { status: "OFFLINE", ageInMinutes };
}

export function ago(value, now = Date.now()) {
  if (!value) return "never";
  const s = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

// ---- GPS trail (breadcrumbs), kept per shipment in localStorage ----

const TRAIL_KEY = (id, scope) => `intelliops-trail-${scope}-${id}`;
const MAX_POINTS = 600;

export function loadTrail(shipmentId, scope = "map") {
  if (!shipmentId) return [];
  try {
    return JSON.parse(localStorage.getItem(TRAIL_KEY(shipmentId, scope))) ?? [];
  } catch {
    return [];
  }
}

export function appendTrail(trail, point) {
  const last = trail[trail.length - 1];
  if (last && last.lat === point.lat && last.lng === point.lng) return trail;
  if (last && point.t <= last.t) return trail;
  return [...trail, point].slice(-MAX_POINTS);
}

export function saveTrail(shipmentId, trail, scope = "map") {
  if (!shipmentId) return;
  try {
    localStorage.setItem(TRAIL_KEY(shipmentId, scope), JSON.stringify(trail));
  } catch {
    /* storage full or blocked: trail stays in memory */
  }
}

export function clearTrail(shipmentId, scope = "map") {
  try {
    localStorage.removeItem(TRAIL_KEY(shipmentId, scope));
  } catch {
    /* ignore */
  }
}

// Points along ROUTE for the "demo drive" (so the map moves indoors on stage).
export function routeSampler(stepKm = 1.2) {
  const points = [];
  for (let i = 0; i < ROUTE.length - 1; i += 1) {
    const a = ROUTE[i];
    const b = ROUTE[i + 1];
    const steps = Math.max(1, Math.round(distanceKm(a, b) / stepKm));
    for (let s = 0; s < steps; s += 1) {
      const f = s / steps;
      points.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  }
  points.push(ROUTE[ROUTE.length - 1]);
  return points;
}
