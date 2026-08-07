"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

require("../src/scripts/calendar_export.js");
const { buildCalendarExport } = globalThis;

/** Fixture: COP 4600 lecture, MoWe 10:30–11:45 AM, Spring 2026 range. */
function lectureMeeting(overrides = {}) {
  return {
    subject: "COP",
    catalogNumber: "4600",
    meetingType: "Lecture",
    classNumber: "12345",
    instructors: ["Jane Doe"],
    mode: "In Person",
    days: ["Mo", "We"],
    startTime: "10:30 AM",
    endTime: "11:45 AM",
    location: "HEC 101",
    rangeStart: "2026-01-12",
    rangeEnd: "2026-04-27",
    ...overrides,
  };
}

function labMeeting(overrides = {}) {
  return lectureMeeting({
    meetingType: "Lab",
    classNumber: "12346",
    days: ["Fr"],
    startTime: "1:00 PM",
    endTime: "2:50 PM",
    location: "HEC 216",
    ...overrides,
  });
}

function vevents(ics) {
  return ics
    .split("BEGIN:VEVENT")
    .slice(1)
    .map(
      (chunk) =>
        "BEGIN:VEVENT" + chunk.split("END:VEVENT")[0] + "END:VEVENT"
    );
}

function field(vevent, name) {
  const re = new RegExp(
    "^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:;[^:]*)?:(.*)$",
    "m"
  );
  const m = vevent.match(re);
  return m ? m[1].trim() : null;
}

function uids(ics) {
  return vevents(ics).map((v) => field(v, "UID"));
}

describe("buildCalendarExport", () => {
  it("returns .ics text plus exported and skipped counts for structured Meetings", () => {
    const result = buildCalendarExport([lectureMeeting()]);
    assert.equal(typeof result.ics, "string");
    assert.equal(result.exported, 1);
    assert.equal(result.skipped, 0);
    assert.match(result.ics, /^BEGIN:VCALENDAR/);
    assert.match(result.ics, /END:VCALENDAR\s*$/);
  });

  it("emits one VEVENT per Meeting (lecture + lab → two events)", () => {
    const result = buildCalendarExport([lectureMeeting(), labMeeting()]);
    assert.equal(result.exported, 2);
    assert.equal(result.skipped, 0);
    assert.equal(vevents(result.ics).length, 2);
    const summaries = vevents(result.ics).map((v) => field(v, "SUMMARY"));
    assert.deepEqual(summaries, ["COP 4600 Lecture", "COP 4600 Lab"]);
  });

  it("encodes weekly recurrence and meeting date range in America/New_York", () => {
    // 2026-01-12 is a Monday — first MoWe occurrence is that day.
    const result = buildCalendarExport([lectureMeeting()]);
    const event = vevents(result.ics)[0];
    assert.equal(field(event, "DTSTART"), "20260112T103000");
    assert.match(event, /DTSTART;TZID=America\/New_York:/);
    assert.equal(field(event, "DTEND"), "20260112T114500");
    assert.match(event, /DTEND;TZID=America\/New_York:/);
    const rrule = field(event, "RRULE");
    assert.match(rrule, /FREQ=WEEKLY/);
    assert.match(rrule, /BYDAY=MO,WE/);
    assert.match(rrule, /UNTIL=20260428T035959Z/); // end of 2026-04-27 EDT
  });

  it("shapes SUMMARY, DESCRIPTION, and LOCATION from Meeting fields", () => {
    const result = buildCalendarExport([lectureMeeting()]);
    const event = vevents(result.ics)[0];
    assert.equal(field(event, "SUMMARY"), "COP 4600 Lecture");
    assert.equal(
      field(event, "DESCRIPTION"),
      "Class number: 12345\\nInstructors: Jane Doe\\nMode: In Person"
    );
    assert.equal(field(event, "LOCATION"), "HEC 101");
  });

  it("omits LOCATION when the Meeting has no room", () => {
    const result = buildCalendarExport([
      lectureMeeting({ location: undefined }),
    ]);
    const event = vevents(result.ics)[0];
    assert.equal(field(event, "LOCATION"), null);
  });

  it("yields the same UIDs across two builds from the same Meetings", () => {
    const meetings = [lectureMeeting(), labMeeting()];
    const a = buildCalendarExport(meetings);
    const b = buildCalendarExport(meetings);
    assert.deepEqual(uids(a.ics), uids(b.ics));
    assert.equal(uids(a.ics).length, 2);
    assert.notEqual(uids(a.ics)[0], uids(a.ics)[1]);
  });

  it("keeps UIDs stable when a Meeting's times or date range change", () => {
    // Story #2/17: re-export after TBA times get real values must update
    // prior events, so time/range changes may not mint a new UID.
    const before = buildCalendarExport([lectureMeeting()]);
    const after = buildCalendarExport([
      lectureMeeting({
        startTime: "2:00 PM",
        endTime: "3:15 PM",
        rangeStart: "2026-01-19",
        rangeEnd: "2026-05-04",
      }),
    ]);
    assert.deepEqual(uids(after.ics), uids(before.ics));
  });

  it("disambiguates same-pattern Meetings within one build", () => {
    // Same class, type, and days at two different times → distinct UIDs,
    // deterministic across rebuilds.
    const meetings = [
      lectureMeeting(),
      lectureMeeting({ startTime: "5:00 PM", endTime: "6:15 PM" }),
    ];
    const a = buildCalendarExport(meetings);
    const b = buildCalendarExport(meetings);
    assert.equal(uids(a.ics).length, 2);
    assert.notEqual(uids(a.ics)[0], uids(a.ics)[1]);
    assert.deepEqual(uids(a.ics), uids(b.ics));
  });

  it("includes a VTIMEZONE for the referenced America/New_York TZID", () => {
    const result = buildCalendarExport([lectureMeeting()]);
    assert.match(result.ics, /BEGIN:VTIMEZONE\r\nTZID:America\/New_York/);
    assert.match(result.ics, /TZNAME:EST/);
    assert.match(result.ics, /TZNAME:EDT/);
    assert.match(result.ics, /END:VTIMEZONE/);
  });

  it("stamps events with a current UTC DTSTAMP", () => {
    const result = buildCalendarExport([lectureMeeting()]);
    const stamp = field(vevents(result.ics)[0], "DTSTAMP");
    assert.match(stamp, /^\d{8}T\d{6}Z$/);
    const year = Number(stamp.slice(0, 4));
    assert.ok(year >= 2026, "DTSTAMP should be build time, not a fixed epoch");
  });

  it("skips non-Exportable Meetings and counts them without inventing times", () => {
    const result = buildCalendarExport([
      lectureMeeting(),
      lectureMeeting({
        meetingType: "Online",
        classNumber: "99901",
        days: [],
        startTime: "TBA",
        endTime: "TBA",
        location: "Online",
      }),
      lectureMeeting({
        meetingType: "Web",
        classNumber: "99902",
        days: ["Mo"],
        startTime: null,
        endTime: null,
      }),
      lectureMeeting({
        meetingType: "Lab",
        classNumber: "99903",
        rangeStart: null,
        rangeEnd: null,
      }),
    ]);
    assert.equal(result.exported, 1);
    assert.equal(result.skipped, 3);
    assert.equal(result.skips.length, 3);
    assert.deepEqual(
      result.skips.map((s) => String(s.classNumber)),
      ["99901", "99902", "99903"]
    );
    assert.equal(vevents(result.ics).length, 1);
    assert.equal(field(vevents(result.ics)[0], "SUMMARY"), "COP 4600 Lecture");
  });

  it("includes no VALARM or default reminders", () => {
    const result = buildCalendarExport([lectureMeeting(), labMeeting()]);
    assert.doesNotMatch(result.ics, /VALARM/);
    assert.doesNotMatch(result.ics, /TRIGGER/);
  });

  it("starts DTSTART on the first matching weekday on or after rangeStart", () => {
    // rangeStart Tuesday 2026-01-13; MoWe → first is Wednesday 2026-01-14
    const result = buildCalendarExport([
      lectureMeeting({ rangeStart: "2026-01-13" }),
    ]);
    const event = vevents(result.ics)[0];
    assert.equal(field(event, "DTSTART"), "20260114T103000");
  });

  it("skips a Meeting when no weekday falls inside the date range", () => {
    // Tuesday-only range, Mo-only meeting → first Mo would be after rangeEnd
    const result = buildCalendarExport([
      lectureMeeting({
        days: ["Mo"],
        rangeStart: "2026-01-13",
        rangeEnd: "2026-01-13",
      }),
    ]);
    assert.equal(result.exported, 0);
    assert.equal(result.skipped, 1);
    assert.equal(vevents(result.ics).length, 0);
    assert.equal(result.skips.length, 1);
    assert.equal(String(result.skips[0].classNumber), "12345");
  });
});
