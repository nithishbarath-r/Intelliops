import L from "leaflet";

export const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const truckSvg =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';

const cache = new Map();

/** Truck marker: orange = excursion, dark = normal; pulse when live; arrow = heading. */
export function truckIcon({ live = false, alert = false, selected = false, heading = null } = {}) {
  const key = `${live}|${alert}|${selected}|${heading == null ? "-" : Math.round(heading / 10)}`;
  if (cache.has(key)) return cache.get(key);
  const size = selected ? 44 : 34;
  const arrow =
    heading != null
      ? `<div class="heading-arrow" style="transform: rotate(${Math.round(heading)}deg); transform-origin: 6px ${size / 2 + 14}px;"></div>`
      : "";
  const icon = L.divIcon({
    className: "driver-map-marker",
    html: `<div class="driver-map-marker-inner ${live ? "live" : ""} ${alert ? "alert" : "calm"} ${selected ? "selected" : ""}" style="width:${size}px;height:${size}px">${arrow}${truckSvg}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 2],
    tooltipAnchor: [0, -size / 2 - 4],
  });
  cache.set(key, icon);
  return icon;
}

export const originIcon = L.divIcon({ className: "stop-marker", html: '<div class="stop-marker-inner"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
export const destinationIcon = L.divIcon({ className: "stop-marker", html: '<div class="stop-marker-inner end"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
