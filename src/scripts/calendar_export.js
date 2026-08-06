"use strict";

/**
 * Calendar Export builder — pure Meetings → .ics (+ counts / skip detail).
 * No DOM, no browser APIs. See issue #3 / CONTEXT.md.
 *
 * Loaded as a content-script global (`window.buildCalendarExport`). Node tests
 * require() this file and read the same binding from globalThis.
 */

/**
 * @typedef {Object} Meeting
 * @property {string} subject
 * @property {string} catalogNumber
 * @property {string} meetingType
 * @property {string|number} classNumber
 * @property {string[]} [instructors]
 * @property {string} [mode]
 * @property {string[]} [days] PeopleSoft-style day codes: Mo, Tu, We, Th, Fr, Sa, Su
 * @property {string} [startTime] e.g. "10:30 AM"
 * @property {string} [endTime] e.g. "11:45 AM"
 * @property {string} [location]
 * @property {string} [rangeStart] YYYY-MM-DD
 * @property {string} [rangeEnd] YYYY-MM-DD
 */

/**
 * @typedef {Object} CalendarExportSkip
 * @property {string|number|null} classNumber
 * @property {string} reason
 */

/**
 * @param {Meeting[]} meetings
 * @returns {{ ics: string, exported: number, skipped: number, skips: CalendarExportSkip[] }}
 */
function buildCalendarExport(meetings) {
  const list = Array.isArray(meetings) ? meetings : [];
  const exportedEvents = [];
  const skips = [];

  for (const meeting of list) {
    const outcome = buildVEvent(meeting);
    if (outcome.vevent) {
      exportedEvents.push(outcome.vevent);
    } else {
      skips.push({
        classNumber:
          meeting && meeting.classNumber != null ? meeting.classNumber : null,
        reason: outcome.reason,
      });
    }
  }

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BetterKnightsUI//Calendar Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...exportedEvents,
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  return {
    ics,
    exported: exportedEvents.length,
    skipped: skips.length,
    skips,
  };
}

const DAY_TO_BYDAY = {
  Mo: "MO",
  Tu: "TU",
  We: "WE",
  Th: "TH",
  Fr: "FR",
  Sa: "SA",
  Su: "SU",
};

const BYDAY_TO_JS = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };

function buildVEvent(meeting) {
  const gate = exportability(meeting);
  if (!gate.ok) return { vevent: null, reason: gate.reason };

  const { days, start, end } = gate;
  const firstDate = firstOccurrenceInRange(
    meeting.rangeStart,
    meeting.rangeEnd,
    days
  );
  if (!firstDate) {
    return { vevent: null, reason: "no-weekday-in-range" };
  }

  const uid = stableUid(meeting, days, start, end);
  const summary = `${meeting.subject} ${meeting.catalogNumber} ${meeting.meetingType}`;
  const description = buildDescription(meeting);
  const dtStart = formatLocal(firstDate, start);
  const dtEnd = formatLocal(firstDate, end);
  const until = untilUtc(meeting.rangeEnd);

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatUtcStamp(new Date(0))}`,
    `DTSTART;TZID=America/New_York:${dtStart}`,
    `DTEND;TZID=America/New_York:${dtEnd}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${days.join(",")};UNTIL=${until}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
  ];

  if (meeting.location != null && String(meeting.location).trim() !== "") {
    lines.push(`LOCATION:${escapeText(String(meeting.location).trim())}`);
  }

  lines.push("END:VEVENT");
  return { vevent: lines.join("\r\n"), reason: null };
}

function exportability(meeting) {
  if (!meeting || typeof meeting !== "object") {
    return { ok: false, reason: "invalid-meeting" };
  }
  if (!meeting.subject || !meeting.catalogNumber || !meeting.meetingType) {
    return { ok: false, reason: "missing-identity" };
  }
  if (meeting.classNumber == null || meeting.classNumber === "") {
    return { ok: false, reason: "missing-class-number" };
  }

  const days = normalizeDays(meeting.days);
  if (days.length === 0) {
    return { ok: false, reason: "tba-or-missing-days" };
  }

  const start = parseClock(meeting.startTime);
  const end = parseClock(meeting.endTime);
  if (!start || !end) {
    return { ok: false, reason: "tba-or-untimed" };
  }

  if (!isIsoDate(meeting.rangeStart) || !isIsoDate(meeting.rangeEnd)) {
    return { ok: false, reason: "missing-date-range" };
  }
  if (meeting.rangeEnd < meeting.rangeStart) {
    return { ok: false, reason: "invalid-date-range" };
  }

  return { ok: true, days, start, end };
}

function buildDescription(meeting) {
  const instructors = Array.isArray(meeting.instructors)
    ? meeting.instructors.filter(Boolean).join(", ")
    : "";
  const parts = [`Class number: ${meeting.classNumber}`];
  if (instructors) parts.push(`Instructors: ${instructors}`);
  if (meeting.mode) parts.push(`Mode: ${meeting.mode}`);
  return parts.join("\n");
}

function stableUid(meeting, byDays, start, end) {
  const key = [
    String(meeting.classNumber),
    String(meeting.meetingType || ""),
    byDays.join(""),
    pad2(start.hours) + pad2(start.minutes),
    pad2(end.hours) + pad2(end.minutes),
    meeting.rangeStart,
    meeting.rangeEnd,
  ].join("-");
  return `${sanitizeUid(key)}@betterknightsui`;
}

function sanitizeUid(s) {
  return s.replace(/[^A-Za-z0-9@._-]/g, "");
}

/** Accept PeopleSoft day tokens only (Mo, Tu, …). */
function normalizeDays(days) {
  if (!Array.isArray(days) || days.length === 0) return [];
  const out = [];
  for (const d of days) {
    if (d == null) continue;
    const raw = String(d).trim();
    if (!raw || /^TBA$/i.test(raw)) continue;
    if (raw.length !== 2) continue;
    const title = raw.charAt(0).toUpperCase() + raw.charAt(1).toLowerCase();
    if (DAY_TO_BYDAY[title]) out.push(DAY_TO_BYDAY[title]);
  }
  const order = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  return order.filter((d) => out.includes(d));
}

function parseClock(timeString) {
  if (timeString == null) return null;
  const s = String(timeString).trim();
  if (!s || /^TBA$/i.test(s)) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const modifier = m[3].toUpperCase();
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (minutes < 0 || minutes > 59 || hours < 1 || hours > 12) return null;
  if (modifier === "PM" && hours < 12) hours += 12;
  if (modifier === "AM" && hours === 12) hours = 0;
  return { hours, minutes };
}

function isIsoDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, mo, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

function parseIsoDate(s) {
  const [y, mo, d] = s.split("-").map(Number);
  return { y, mo, d };
}

function isoFromParts(parts) {
  return `${parts.y}-${pad2(parts.mo)}-${pad2(parts.d)}`;
}

function firstOccurrenceInRange(rangeStart, rangeEnd, byDays) {
  const allowed = new Set(byDays.map((d) => BYDAY_TO_JS[d]));
  const { y, mo, d } = parseIsoDate(rangeStart);
  const cursor = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  for (let i = 0; i < 7; i++) {
    const parts = {
      y: cursor.getUTCFullYear(),
      mo: cursor.getUTCMonth() + 1,
      d: cursor.getUTCDate(),
    };
    if (isoFromParts(parts) > rangeEnd) return null;
    if (allowed.has(cursor.getUTCDay())) return parts;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return null;
}

function formatLocal(dateParts, clock) {
  return (
    String(dateParts.y) +
    pad2(dateParts.mo) +
    pad2(dateParts.d) +
    "T" +
    pad2(clock.hours) +
    pad2(clock.minutes) +
    "00"
  );
}

/** UNTIL = end of rangeEnd local day in America/New_York, as UTC. */
function untilUtc(rangeEndIso) {
  return formatUtcStamp(wallTimeInNewYorkToUtc(`${rangeEndIso}T23:59:59`));
}

/** Convert a naive America/New_York wall time to a UTC Date via Intl. */
function wallTimeInNewYorkToUtc(localIsoNoZone) {
  const [datePart, timePart] = localIsoNoZone.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [hh, mm, ss] = timePart.split(":").map(Number);

  let guess = Date.UTC(y, mo - 1, d, hh + 5, mm, ss);
  for (let i = 0; i < 4; i++) {
    const parts = newYorkWallParts(new Date(guess));
    const wanted =
      Date.UTC(y, mo - 1, d, hh, mm, ss) -
      Date.UTC(parts.y, parts.mo - 1, parts.d, parts.hh, parts.mm, parts.ss);
    guess += wanted;
    if (wanted === 0) break;
  }
  return new Date(guess);
}

function newYorkWallParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    y: Number(map.year),
    mo: Number(map.month),
    d: Number(map.day),
    hh: Number(map.hour),
    mm: Number(map.minute),
    ss: Number(map.second),
  };
}

function formatUtcStamp(date) {
  return (
    date.getUTCFullYear() +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    "T" +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

(typeof window !== "undefined" ? window : globalThis).buildCalendarExport =
  buildCalendarExport;
