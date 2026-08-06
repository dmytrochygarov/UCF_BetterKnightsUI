"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

require("../src/scripts/calendar_export.js");
require("../src/scripts/schedule_extract.js");
require("../src/scripts/calendar_export_page.js");

const {
  buildCalendarExport,
  extractEnrolledMeetings,
  formatCalendarExportToast,
  calendarExportFilename,
} = globalThis;

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "enrolled_list_view.html"),
  "utf8"
);

describe("formatCalendarExportToast", () => {
  it("reports exported and skipped counts with re-export guidance", () => {
    const text = formatCalendarExportToast({ exported: 4, skipped: 1 });
    assert.match(text, /Exported 4 meetings/i);
    assert.match(text, /skipped 1/i);
    assert.match(text, /export again when TBA\/times are announced/i);
  });

  it("uses singular wording for one exported and one skipped", () => {
    const text = formatCalendarExportToast({ exported: 1, skipped: 1 });
    assert.match(text, /Exported 1 meeting,/i);
    assert.match(text, /skipped 1 meeting\b/i);
  });

  it("reports a clean export with no skip guidance", () => {
    const text = formatCalendarExportToast({ exported: 3, skipped: 0 });
    assert.match(text, /Exported 3 meetings/i);
    assert.doesNotMatch(text, /skipped/i);
    assert.doesNotMatch(text, /TBA/i);
  });

  it("explains when nothing was exported", () => {
    const text = formatCalendarExportToast({ exported: 0, skipped: 2 });
    assert.match(text, /Exported 0 meetings/i);
    assert.match(text, /skipped 2/i);
    assert.match(text, /export again when TBA\/times are announced/i);
  });

  it("explains when no registered meetings were found", () => {
    const text = formatCalendarExportToast({ exported: 0, skipped: 0 });
    assert.match(text, /No registered meetings/i);
  });
});

describe("calendarExportFilename", () => {
  it("returns a human-readable .ics name", () => {
    assert.equal(calendarExportFilename(), "ucf-enrolled-schedule.ics");
  });
});

describe("extract → build → toast (fixture)", () => {
  it("produces ICS and a skip toast for the enrolled list fixture", () => {
    const doc = new JSDOM(FIXTURE).window.document;
    const meetings = extractEnrolledMeetings(doc);
    const result = buildCalendarExport(meetings);
    assert.ok(result.exported >= 1);
    assert.ok(result.skipped >= 1);
    assert.match(result.ics, /BEGIN:VCALENDAR/);
    assert.doesNotMatch(result.ics, /VALARM/);

    const toast = formatCalendarExportToast(result);
    assert.match(toast, new RegExp(`Exported ${result.exported} meetings`, "i"));
    assert.match(toast, new RegExp(`skipped ${result.skipped}`, "i"));
    assert.match(toast, /TBA\/times are announced/i);
  });
});
