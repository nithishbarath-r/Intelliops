// GPS helpers shared by the driver app and the coordinator live map.

export const ORIGIN = { name: "Chennai State Store", lat: 13.0827, lon: 80.2707 };
export const DESTINATION = { name: "Madurai District Store", lat: 9.9252, lon: 78.1198 };

const R = 6371; // km
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Initial bearing in degrees (0 = north). */
export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

export function compass(deg) {
  if (deg == null || Number.isNaN(deg)) return "—";
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

/**
 * Speed (km/h) and heading from the last two trail points.
 * Ignores jitter: points closer than 15 m or less than 3 s apart.
 */
export function motion(trail) {
  if (!trail || trail.length < 2) return { speedKmh: null, heading: null };
  const b = trail[trail.length - 1];
  for (let i = trail.length - 2; i >= 0; i -= 1) {
    const a = trail[i];
    const km = distanceKm(a, b);
    const hours = (new Date(b.ts) - new Date(a.ts)) / 3600000;
    if (km >= 0.015 && hours >= 3 / 3600) {
      return { speedKmh: Math.min(180, km / hours), heading: bearingDeg(a, b) };
    }
  }
  return { speedKmh: 0, heading: null };
}

// Demo drive: the last stretch of CN-24018, from ~11 km before Melur junction into Madurai.
const DEMO_WAYPOINTS = [
  { lat: 10.1285, lon: 78.3905 },
  { lat: 10.0765, lon: 78.3630 },
  { lat: 10.032, lon: 78.338 },
  { lat: 9.995, lon: 78.265 },
  { lat: 9.962, lon: 78.18 },
  { lat: 9.9252, lon: 78.1198 },
];

/** Points every `stepKm` along the demo route. */
export function demoRoute(stepKm = 0.035) {
  const points = [];
  for (let i = 0; i < DEMO_WAYPOINTS.length - 1; i += 1) {
    const a = DEMO_WAYPOINTS[i];
    const b = DEMO_WAYPOINTS[i + 1];
    const steps = Math.max(1, Math.round(distanceKm(a, b) / stepKm));
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      points.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    }
  }
  points.push(DEMO_WAYPOINTS[DEMO_WAYPOINTS.length - 1]);
  return points;
}
