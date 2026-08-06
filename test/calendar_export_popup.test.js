"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

require("../src/scripts/calendar_export.js");
require("../src/scripts/schedule_extract.js");
require("../src/scripts/calendar_export_page.js");

const {
  calendarExportPopupState,
  handleCalendarExportPortMessage,
} = globalThis;

describe("calendarExportPopupState", () => {
  it("enables Export when the active page is My Class Schedule list view", () => {
    const state = calendarExportPopupState({ onSchedule: true });
    assert.equal(state.available, true);
    assert.equal(state.buttonLabel, "Export to calendar");
  });

  it("disables Export with a clear inactive hint when not on that page", () => {
    const state = calendarExportPopupState({ onSchedule: false });
    assert.equal(state.available, false);
    assert.match(state.inactiveHint, /My Class Schedule/i);
    assert.match(state.inactiveHint, /list view/i);
  });

  it("treats a missing probe as unavailable", () => {
    const state = calendarExportPopupState(null);
    assert.equal(state.available, false);
    assert.ok(state.inactiveHint);
  });

  it("disables Export when the extension is turned off", () => {
    const state = calendarExportPopupState({
      onSchedule: true,
      extensionEnabled: false,
    });
    assert.equal(state.available, false);
    assert.match(state.inactiveHint, /Enable the extension/i);
  });
});

describe("handleCalendarExportPortMessage", () => {
  it("answers probe with onSchedule from the page context", () => {
    const reply = handleCalendarExportPortMessage(
      { type: "probe" },
      { onSchedule: true, runExport: () => null }
    );
    assert.deepEqual(reply, { type: "probeResult", onSchedule: true });
  });

  it("runs the shared export pipeline on run when on schedule", () => {
    let called = 0;
    const result = { exported: 2, skipped: 1, ics: "BEGIN:VCALENDAR" };
    const reply = handleCalendarExportPortMessage(
      { type: "run" },
      {
        onSchedule: true,
        runExport: () => {
          called += 1;
          return result;
        },
      }
    );
    assert.equal(called, 1);
    assert.deepEqual(reply, { type: "runResult", ok: true, result });
  });

  it("does not run export when not on My Class Schedule list view", () => {
    let called = 0;
    const reply = handleCalendarExportPortMessage(
      { type: "run" },
      {
        onSchedule: false,
        runExport: () => {
          called += 1;
          return { exported: 1 };
        },
      }
    );
    assert.equal(called, 0);
    assert.deepEqual(reply, {
      type: "runResult",
      ok: false,
      onSchedule: false,
    });
  });

  it("reports failure when the shared pipeline returns nothing", () => {
    const reply = handleCalendarExportPortMessage(
      { type: "run" },
      { onSchedule: true, runExport: () => null }
    );
    assert.deepEqual(reply, {
      type: "runResult",
      ok: false,
      onSchedule: true,
    });
  });

  it("ignores unknown message types", () => {
    const reply = handleCalendarExportPortMessage(
      { type: "nope" },
      { onSchedule: true, runExport: () => null }
    );
    assert.equal(reply, null);
  });
});
