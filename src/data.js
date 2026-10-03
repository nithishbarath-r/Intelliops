// Demo data and helpers shared by the coordinator screens.
// Values are unchanged from the original prototype.

export const drivers = [
  {
    id: "driver-1",
    name: "Raghul",
    initials: "RJ",
    vehicle: "TN 09 AB 4521",
    type: "Long-haul reefer",
    phone: "+919159708095",
    location: "11 km from Melur junction",
  },
  {
    id: "driver-2",
    name: "Nithin Adhithya",
    initials: "NA",
    vehicle: "TN 58 CD 1187",
    type: "Refrigerated van",
    phone: "+919363498553",
    location: "Near Tirumangalam bypass",
  },
  {
    id: "driver-3",
    name: "Prakash",
    initials: "P",
    vehicle: "TN 37 EF 7620",
    type: "Cold-chain carrier",
    phone: "+916381920030",
    location: "8 km from Sivaganga road",
  },
  {
    id: "driver-4",
    name: "Nithish Barath",
    initials: "NB",
    vehicle: "TN 45 GH 3098",
    type: "District distribution van",
    phone: "+919843759696",
    location: "Madurai district checkpoint",
  },
  {
    id: "driver-5",
    name: "Sabarish Krishnan",
    initials: "SK",
    vehicle: "TN 63 JK 8842",
    type: "Last-mile vaccine carrier",
    phone: "+918807087857",
    location: "Near district store entrance",
  },
];

export function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDriverForDate(date) {
  const parsedDate = new Date(`${date}T00:00:00`);

  if (Number.isNaN(parsedDate.getTime())) {
    return drivers[0];
  }

  const referenceDate = new Date("2026-09-27T00:00:00");
  const daysDifference = Math.floor(
    (parsedDate - referenceDate) / (1000 * 60 * 60 * 24)
  );
  const driverIndex =
    ((daysDifference % drivers.length) + drivers.length) % drivers.length;

  return drivers[driverIndex];
}

export function formatDateLabel(date) {
  const parsedDate = new Date(`${date}T00:00:00`);

  if (Number.isNaN(parsedDate.getTime())) {
    return "Selected date";
  }

  return parsedDate.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// History is relative to the real "today": offset 0 is the live scenario.
const historyByOffset = {
  0: {
    label: "Today",
    normal: 196,
    attention: 4,
    leadTime: "2h 10m",
    children: 380,
    health: "94%",
    incident: "CN-24018 — Chennai → Madurai",
    incidentDetails: "9.2°C and rising · Stationary for 40 minutes",
  },
  1: {
    label: "Yesterday",
    normal: 198,
    attention: 2,
    leadTime: "3h 25m",
    children: 120,
    health: "97%",
    incident: "CN-24011 — Salem → Erode",
    incidentDetails: "Handover dwell exceeded normal route pattern",
  },
  2: {
    normal: 199,
    attention: 1,
    leadTime: "4h 05m",
    children: 60,
    health: "99%",
    incident: "CN-23998 — Chennai → Tiruchirappalli",
    incidentDetails: "Logger reported intermittent connectivity",
  },
};

function daysBeforeToday(date) {
  const selected = new Date(`${date}T00:00:00`);
  const today = new Date(`${getTodayDate()}T00:00:00`);
  if (Number.isNaN(selected.getTime())) return 0;
  return Math.round((today - selected) / (1000 * 60 * 60 * 24));
}

/** ISO date `offset` days before today. */
export function dateDaysAgo(offset) {
  const d = new Date(`${getTodayDate()}T00:00:00`);
  d.setDate(d.getDate() - offset);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getHistoryForDate(date) {
  const daysAgo = daysBeforeToday(date);

  if (daysAgo <= 0) {
    return { ...historyByOffset[0], label: daysAgo === 0 ? "Today" : formatDateLabel(date) };
  }
  if (historyByOffset[daysAgo]) {
    return { label: formatDateLabel(date), ...historyByOffset[daysAgo] };
  }

  const normal = Math.max(170, 196 - (daysAgo % 20));
  const attention = 1 + (daysAgo % 5);
  const leadTimeHours = 2 + (daysAgo % 4);
  const leadTimeMinutes = 10 + ((daysAgo * 13) % 50);
  const children = 60 + ((daysAgo * 80) % 420);
  const health = Math.max(82, 100 - attention * 2);

  return {
    label: formatDateLabel(date),
    normal,
    attention,
    leadTime: `${leadTimeHours}h ${leadTimeMinutes}m`,
    children,
    health: `${health}%`,
    incident: `Historical review — ${formatDateLabel(date)}`,
    incidentDetails: `Archived network data for ${formatDateLabel(date)}.`,
  };
}

export const temperatureData = [
  { time: "10:20", temperature: 5.8 },
  { time: "10:40", temperature: 6.2 },
  { time: "11:00", temperature: 7.1 },
  { time: "11:20", temperature: 8.3 },
  { time: "11:40", temperature: 9.2 },
];

export const recoveryOptions = [
  {
    id: "DIVERT_REICE",
    name: "Divert + re-ice",
    cost: "₹18,500",
    eta: "3h 05m",
    risk: "Low",
    facilities: 14,
    recommended: true,
  },
  {
    id: "QUARANTINE",
    name: "Quarantine consignment",
    cost: "₹42,000",
    eta: "Unavailable",
    risk: "Very low",
    facilities: 0,
    recommended: false,
  },
  {
    id: "REALLOCATE_BUFFER",
    name: "Reallocate buffer stock",
    cost: "₹31,000",
    eta: "5h 20m",
    risk: "Medium",
    facilities: 9,
    recommended: false,
  },
];

export const agentMessagesScript = [
  "Event Mesh received temperature event from CN-24018.",
  "Sensing Agent classified the excursion as HIGH.",
  "Scenario Agent calculated 2h 10m until breach.",
  "Inventory Agent found 14 affected facilities and 380 children at risk.",
  "Logistics Agent simulated 3 recovery options.",
  "Compliance Agent blocked automatic product disposition.",
  "Human approval requested from Meera Raghavan.",
];

// Consignments shown in the cockpit table (demo data).
// The first row always uses the driver assigned for the selected date.
export function getConsignments(assignedDriver) {
  return [
    {
      id: "CN-24018",
      driver: assignedDriver.name,
      from: "Chennai",
      to: "Madurai",
      vehicle: assignedDriver.vehicle,
      type: assignedDriver.type,
      temp: "9.2°C",
      status: "excursion",
    },
    { id: "CN-24011", driver: "Nithin Adhithya", from: "Salem", to: "Erode", vehicle: "TN 58 CD 1187", type: "Refrigerated van", temp: "5.1°C", status: "watch" },
    { id: "CN-24025", driver: "Prakash", from: "Tiruchirappalli", to: "Sivaganga", vehicle: "TN 37 EF 7620", type: "Cold-chain carrier", temp: "—", status: "silent" },
    { id: "CN-24014", driver: "Depot pool", from: "Erode", to: "Namakkal", vehicle: "TN 33 LM 2210", type: "Refrigerated van", temp: "—", status: "silent" },
    { id: "CN-24027", driver: "Nithish Barath", from: "Madurai", to: "Melur", vehicle: "TN 45 GH 3098", type: "District van", temp: "4.6°C", status: "normal" },
    { id: "CN-24029", driver: "Sabarish Krishnan", from: "Madurai store", to: "PHC Tirumangalam", vehicle: "TN 63 JK 8842", type: "Vaccine carrier", temp: "3.9°C", status: "normal" },
  ];
}

export const statusMeta = {
  excursion: { label: "Excursion", color: "#d9541e" },
  watch: { label: "Watch", color: "#e0a84e" },
  silent: { label: "Silent", color: "#9a9e97" },
  normal: { label: "In range", color: "#6e8f1a" },
};

export const driverIdByLocalId = {
  "driver-1": "98f6ab92-f576-4204-9147-0ffe3568119f",
  "driver-2": "ef947363-3375-4bbd-ae22-4493659589ef",
  "driver-3": "565c5093-e106-4989-a74f-a57de561615d",
  "driver-4": "75157a54-8579-49d3-a3a8-07e69b0bd8b2",
  "driver-5": "df138093-7f4b-4861-8980-e3d8c924e53a",
};

export const shipmentByDriver = {
  "98f6ab92-f576-4204-9147-0ffe3568119f": "a93bf90d-825e-469c-9df0-9c4ca28b91b7",
  "ef947363-3375-4bbd-ae22-4493659589ef": "efbd4c6f-d20b-4252-872f-5631a9a25d8c",
  "565c5093-e106-4989-a74f-a57de561615d": "3f744479-f440-4b8c-b1d1-fce5b6948b8d",
  "75157a54-8579-49d3-a3a8-07e69b0bd8b2": "aca45fe1-5dfb-41bd-8911-651ae5748e1e",
  "df138093-7f4b-4861-8980-e3d8c924e53a": "87b68c3b-c876-49a9-927b-c8e29578ff9d",
};

export function initialsOf(name = "") {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "?"
  );
}
