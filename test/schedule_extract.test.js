"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

require("../src/scripts/schedule_extract.js");
const {
  isMyClassScheduleListView,
  extractEnrolledMeetings,
} = globalThis;

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "enrolled_list_view.html"),
  "utf8"
);

function loadFixture(html = FIXTURE) {
  return new JSDOM(html).window.document;
}

describe("isMyClassScheduleListView", () => {
  it("recognizes My Class Schedule list view", () => {
    assert.equal(isMyClassScheduleListView(loadFixture()), true);
  });

  it("rejects class search results markup", () => {
    const doc = loadFixture(`<!DOCTYPE html><html><body>
      <div id="win0divSSR_CLSRSLT_WRK_GROUPBOX2$0"></div>
      <div id="DERIVED_REGFRM1_TITLE1">Search for Classes</div>
    </body></html>`);
    assert.equal(isMyClassScheduleListView(doc), false);
  });

  it("rejects Weekly Schedule grid markup without list meeting tables", () => {
    const doc = loadFixture(`<!DOCTYPE html><html><body>
      <span id="DERIVED_REGFRM1_SS_TRANSACT_TITLE">My Class Schedule</span>
      <form action="/psc/c/SA_LEARNER_SERVICES.SS_WEEKLY_SCHEDULE.GBL"></form>
      <table id="WEEKLY_SCHED_HTMLAREA"></table>
    </body></html>`);
    assert.equal(isMyClassScheduleListView(doc), false);
  });
});

describe("extractEnrolledMeetings", () => {
  it("returns registered Meetings only from the list view", () => {
    const meetings = extractEnrolledMeetings(loadFixture());
    const classNumbers = meetings.map((m) => String(m.classNumber)).sort();
    assert.deepEqual(classNumbers, [
      "12345",
      "12345",
      "12346",
      "22222",
      "55555",
    ]);
    assert.ok(!classNumbers.includes("33333"));
    assert.ok(!classNumbers.includes("44444"));
  });

  it("populates builder Meeting fields when present on the page", () => {
    const meetings = extractEnrolledMeetings(loadFixture());
    const lecture = meetings.find(
      (m) =>
        m.classNumber === "12345" &&
        m.meetingType === "Lecture" &&
        m.days &&
        m.days[0] === "Mo"
    );
    assert.ok(lecture);
    assert.equal(lecture.subject, "COP");
    assert.equal(lecture.catalogNumber, "4600");
    assert.deepEqual(lecture.days, ["Mo", "We"]);
    assert.equal(lecture.startTime, "10:30 AM");
    assert.equal(lecture.endTime, "11:45 AM");
    assert.equal(lecture.location, "HEC 101");
    assert.equal(lecture.rangeStart, "2026-01-12");
    assert.equal(lecture.rangeEnd, "2026-04-27");
    assert.deepEqual(lecture.instructors, ["Jane Doe"]);

    const lab = meetings.find((m) => m.classNumber === "12346");
    assert.ok(lab);
    assert.equal(lab.meetingType, "Laboratory");
    assert.deepEqual(lab.days, ["Fr"]);
    assert.equal(lab.startTime, "1:00 PM");
    assert.equal(lab.endTime, "2:50 PM");
    assert.equal(lab.location, "HEC 216");

    const continuation = meetings.find(
      (m) => m.classNumber === "12345" && m.days && m.days[0] === "We" && m.days.length === 1
    );
    assert.ok(continuation);
    assert.equal(continuation.meetingType, "Lecture"); // inherits prior lecture row
    assert.equal(continuation.startTime, "7:00 PM");
    assert.deepEqual(continuation.instructors, ["Jane Doe"]);

    const enc = meetings.find((m) => m.classNumber === "22222");
    assert.ok(enc);
    assert.deepEqual(enc.days, ["Tu", "Th"]);
    assert.equal(enc.startTime, "9:00 AM");
    assert.equal(enc.endTime, "10:15 AM");
    assert.deepEqual(enc.instructors, ["Alex Smith", "Pat Lee"]);
    assert.equal(enc.mode, "In Person");
  });

  it("still extracts enrolled TBA Meetings for the builder to skip", () => {
    const meetings = extractEnrolledMeetings(loadFixture());
    const tba = meetings.find((m) => m.classNumber === "55555");
    assert.ok(tba);
    assert.equal(tba.subject, "CGS");
    assert.equal(tba.location, "Online");
    assert.deepEqual(tba.days, []);
    assert.equal(tba.startTime, null);
    assert.equal(tba.endTime, null);
  });

  it("returns an empty list when the document is not list view", () => {
    const doc = loadFixture(`<!DOCTYPE html><html><body>
      <div id="win0divSSR_CLSRSLT_WRK_GROUPBOX2$0"></div>
    </body></html>`);
    assert.deepEqual(extractEnrolledMeetings(doc), []);
  });

  it("feeds the Calendar Export builder without inventing waitlisted rows", () => {
    require("../src/scripts/calendar_export.js");
    const { buildCalendarExport } = globalThis;
    const meetings = extractEnrolledMeetings(loadFixture());
    const result = buildCalendarExport(meetings);
    // 12345 MoWe, 12345 We evening, 12346 lab, 22222 ENC — TBA 55555 skipped
    assert.equal(result.exported, 4);
    assert.equal(result.skipped, 1);
    assert.equal(String(result.skips[0].classNumber), "55555");
    assert.doesNotMatch(result.ics, /33333|44444/);
  });
});
