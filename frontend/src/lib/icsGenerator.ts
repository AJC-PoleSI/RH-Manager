/**
 * ICS Calendar File Generator
 * Generates RFC 5545 compliant .ics files for calendar integration.
 * No external dependencies — pure JS/TS utility.
 */

export interface ICSEvent {
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  organizer?: string;
}

/**
 * Format a Date to ICS DTSTART/DTEND format: 20260617T110000Z
 */
function formatICSDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Generate a simple UUID-like string for the event UID.
 */
function generateUID(): string {
  const s4 = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

/**
 * Escape special characters in ICS text fields per RFC 5545.
 */
function escapeICS(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Generate an ICS calendar string from event data.
 * Accepts a single event or an array of events.
 */
export function generateICS(events: ICSEvent | ICSEvent[]): string {
  const eventArray = Array.isArray(events) ? events : [events];

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RH Manager AJC//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  eventArray.forEach((event) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${generateUID()}@rhmanager.ajc.fr`,
      `DTSTAMP:${formatICSDate(new Date())}`,
      `DTSTART:${formatICSDate(event.startDate)}`,
      `DTEND:${formatICSDate(event.endDate)}`,
      `SUMMARY:${escapeICS(event.title)}`
    );

    if (event.description) {
      lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
    }
    if (event.location) {
      lines.push(`LOCATION:${escapeICS(event.location)}`);
    }
    if (event.organizer) {
      lines.push(`ORGANIZER:mailto:${event.organizer}`);
    }

    lines.push("STATUS:CONFIRMED", "END:VEVENT");
  });

  lines.push("END:VCALENDAR");

  // ICS requires CRLF line endings
  return lines.join("\r\n");
}

/**
 * Trigger a browser download of the ICS file.
 */
export function downloadICS(icsContent: string, filename: string): void {
  const blob = new Blob([icsContent], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
