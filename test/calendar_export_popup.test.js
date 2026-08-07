"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

require("../src/scripts/calendar_export.js");
require("../src/scripts/schedule_extract.js");
require("../src/scripts/calendar_export_page.js");

const {
  calendarExportPopupState,
  handleCalendarExportMessage,
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

describe("handleCalendarExportMessage", () => {
  const ctx = (overrides = {}) => ({
    onSchedule: true,
    enabled: true,
    runExport: () => null,
    ...overrides,
  });

  it("answers a probe from the schedule frame", () => {
    const reply = handleCalendarExportMessage(
      { action: "bkuiCalendarExportProbe" },
      ctx()
    );
    assert.deepEqual(reply, { onSchedule: true });
  });

  it("stays silent on probe when not on My Class Schedule list view", () => {
    const reply = handleCalendarExportMessage(
      { action: "bkuiCalendarExportProbe" },
      ctx({ onSchedule: false })
    );
    assert.equal(reply, null);
  });

  it("runs the shared export pipeline on run when on schedule", () => {
    let called = 0;
    const result = { exported: 2, skipped: 1, ics: "BEGIN:VCALENDAR" };
    const reply = handleCalendarExportMessage(
      { action: "bkuiCalendarExportRun" },
      ctx({
        runExport: () => {
          called += 1;
          return result;
        },
      })
    );
    assert.equal(called, 1);
    assert.deepEqual(reply, { ok: true, onSchedule: true, result });
  });

  it("stays silent on run when not on My Class Schedule list view", () => {
    let called = 0;
    const reply = handleCalendarExportMessage(
      { action: "bkuiCalendarExportRun" },
      ctx({
        onSchedule: false,
        runExport: () => {
          called += 1;
          return { exported: 1 };
        },
      })
    );
    assert.equal(called, 0);
    assert.equal(reply, null);
  });

  it("stays silent on run when the extension is disabled", () => {
    let called = 0;
    const reply = handleCalendarExportMessage(
      { action: "bkuiCalendarExportRun" },
      ctx({
        enabled: false,
        runExport: () => {
          called += 1;
          return { exported: 1 };
        },
      })
    );
    assert.equal(called, 0);
    assert.equal(reply, null);
  });

  it("reports failure when the shared pipeline returns nothing", () => {
    const reply = handleCalendarExportMessage(
      { action: "bkuiCalendarExportRun" },
      ctx()
    );
    assert.deepEqual(reply, { ok: false, onSchedule: true });
  });

  it("ignores unknown message actions", () => {
    const reply = handleCalendarExportMessage({ action: "nope" }, ctx());
    assert.equal(reply, null);
  });
});
