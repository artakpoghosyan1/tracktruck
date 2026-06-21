import tzlookup from "tz-lookup";

const US_TIMEZONE_LABELS: Record<string, string> = {
  "America/New_York": "Eastern Time",
  "America/Chicago": "Central Time",
  "America/Denver": "Mountain Time",
  "America/Phoenix": "Mountain Time (no DST)",
  "America/Los_Angeles": "Pacific Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
};

export function getTimezoneForCoords(lat: number, lng: number): { timezone: string; label: string } {
  const timezone = tzlookup(lat, lng);
  const knownLabel = US_TIMEZONE_LABELS[timezone];
  if (knownLabel) {
    return { timezone, label: knownLabel };
  }
  // Fall back to Intl for non-US or edge cases
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZoneName: "long", timeZone: timezone });
    const label = fmt.formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? timezone;
    return { timezone, label };
  } catch {
    return { timezone, label: timezone };
  }
}
