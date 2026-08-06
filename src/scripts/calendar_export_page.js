"use strict";

/**
 * My Class Schedule page UI for Calendar Export (#5 / #6).
 * Extract → build → .ics download + skip toast. Shared runCalendarExport
 * is the hook for both the page control and the extension popup.
 *
 * Content-script globals; Node tests require() the pure helpers.
 */

/** Port name shared with background.js for popup ↔ schedule-frame messaging. */
const BKUI_CALENDAR_EXPORT_PORT = "bkui-calendar-export";

/**
 * Popup Export button availability from a schedule-frame probe.
 * @param {{ onSchedule?: boolean, extensionEnabled?: boolean }|null|undefined} probe
 * @returns {{ available: boolean, buttonLabel: string, inactiveHint: string }}
 */
function calendarExportPopupState(probe) {
  const enabled = !probe || probe.extensionEnabled !== false;
  const onSchedule = !!(probe && probe.onSchedule);
  return {
    available: enabled && onSchedule,
    buttonLabel: "Export to calendar",
    inactiveHint: enabled
      ? "Open My Class Schedule (list view) to export."
      : "Enable the extension to export your schedule.",
  };
}

/**
 * Content-script side of the popup port protocol.
 * @param {{ type?: string }|null|undefined} message
 * @param {{ onSchedule: boolean, runExport: function(): * }} ctx
 * @returns {Object|null}
 */
function handleCalendarExportPortMessage(message, ctx) {
  if (!message || !message.type) return null;

  if (message.type === "probe") {
    return { type: "probeResult", onSchedule: !!ctx.onSchedule };
  }

  if (message.type === "run") {
    if (!ctx.onSchedule) {
      return { type: "runResult", ok: false, onSchedule: false };
    }
    const result = ctx.runExport();
    if (!result) {
      return { type: "runResult", ok: false, onSchedule: true };
    }
    return { type: "runResult", ok: true, result };
  }

  return null;
}

/**
 * @param {{ exported?: number, skipped?: number }} result
 * @returns {string}
 */
function formatCalendarExportToast(result) {
  const exported = result && result.exported != null ? Number(result.exported) : 0;
  const skipped = result && result.skipped != null ? Number(result.skipped) : 0;

  if (exported === 0 && skipped === 0) {
    return "No registered meetings found to export.";
  }

  const exportedLabel =
    exported === 1 ? "Exported 1 meeting" : "Exported " + exported + " meetings";

  if (skipped === 0) {
    return exportedLabel + " to your calendar file.";
  }

  const skippedLabel =
    skipped === 1 ? "skipped 1 meeting" : "skipped " + skipped + " meetings";

  return (
    exportedLabel +
    ", " +
    skippedLabel +
    ". Export again when TBA/times are announced."
  );
}

/** Human-readable default download name (term hint deferred until available). */
function calendarExportFilename() {
  return "ucf-enrolled-schedule.ics";
}

/**
 * Trigger a local .ics download (blob URL). No network.
 * @param {string} icsText
 * @param {string} [filename]
 */
function downloadCalendarIcs(icsText, filename) {
  const name = filename || calendarExportFilename();
  const blob = new Blob([icsText], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 1000);
}

const root = typeof window !== "undefined" ? window : globalThis;

/**
 * Full Calendar Export pipeline for the current document.
 * @returns {{ ics: string, exported: number, skipped: number, skips: Object[] }|null}
 */
function runCalendarExport() {
  if (typeof extractEnrolledMeetings !== "function") return null;
  if (typeof buildCalendarExport !== "function") return null;

  const meetings = extractEnrolledMeetings(document);
  const result = buildCalendarExport(meetings);

  if (result.exported > 0) {
    downloadCalendarIcs(result.ics, calendarExportFilename());
  }

  // Toast on skip / partial / empty — download feedback covers a clean export.
  if (
    typeof showToast === "function" &&
    (result.skipped > 0 || result.exported === 0)
  ) {
    showToast(formatCalendarExportToast(result));
  }

  return result;
}

/**
 * Keep a background port open only while this frame hosts list view and
 * the extension is enabled — so the popup can reach the iframe that has DOM.
 * @param {boolean} isEnabled
 */
function syncCalendarExportPort(isEnabled) {
  if (typeof browser === "undefined" || !browser.runtime || !browser.runtime.connect) {
    return;
  }

  const onList =
    typeof isMyClassScheduleListView === "function" &&
    isMyClassScheduleListView(document);
  const shouldConnect = !!isEnabled && onList;
  const existing = root.__bkuiCalendarExportPort;

  if (!shouldConnect) {
    if (existing) {
      try {
        existing.disconnect();
      } catch (_) {
        /* ignore */
      }
      root.__bkuiCalendarExportPort = null;
    }
    return;
  }

  if (existing) return;

  const port = browser.runtime.connect({ name: BKUI_CALENDAR_EXPORT_PORT });
  root.__bkuiCalendarExportPort = port;

  port.onMessage.addListener(function (message) {
    const reply = handleCalendarExportPortMessage(message, {
      onSchedule:
        typeof isMyClassScheduleListView === "function" &&
        isMyClassScheduleListView(document),
      runExport: runCalendarExport,
    });
    if (reply) port.postMessage(reply);
  });

  port.onDisconnect.addListener(function () {
    if (root.__bkuiCalendarExportPort === port) {
      root.__bkuiCalendarExportPort = null;
    }
  });
}

/**
 * Idempotent page control. Guard: .betterknightsui-calendar-export-btn.
 * Honors extension enable/disable like other chrome.
 * @param {boolean} isEnabled
 */
function injectCalendarExportControl(isEnabled) {
  syncCalendarExportPort(isEnabled);

  if (typeof $ === "undefined") return;

  const onList =
    typeof isMyClassScheduleListView === "function" &&
    isMyClassScheduleListView(document);

  if (!isEnabled || !onList) {
    $(".betterknightsui-calendar-export").remove();
    return;
  }

  if ($(".betterknightsui-calendar-export-btn").length) return;

  const $bar = $(
    '<div class="betterknightsui-calendar-export" role="region" ' +
      'aria-label="Calendar Export">' +
      '<button type="button" class="betterknightsui-calendar-export-btn">' +
      "Export to calendar" +
      "</button>" +
      '<span class="betterknightsui-calendar-export-hint">' +
      "Downloads a .ics of your enrolled schedule" +
      "</span>" +
      "</div>"
  );

  $bar.find(".betterknightsui-calendar-export-btn").on("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    runCalendarExport();
  });

  const $titleHost = $("#win0divDERIVED_REGFRM1_SS_TRANSACT_TITLE");
  if ($titleHost.length) {
    $titleHost.after($bar);
    return;
  }

  const $title = $("#DERIVED_REGFRM1_SS_TRANSACT_TITLE");
  if ($title.length) {
    $title.after($bar);
    return;
  }

  const $firstCourse = $('div[id^="win0divDERIVED_REGFRM1_DESCR20$"]').first();
  if ($firstCourse.length) {
    $firstCourse.before($bar);
  }
}

root.formatCalendarExportToast = formatCalendarExportToast;
root.calendarExportFilename = calendarExportFilename;
root.downloadCalendarIcs = downloadCalendarIcs;
root.runCalendarExport = runCalendarExport;
root.injectCalendarExportControl = injectCalendarExportControl;
root.calendarExportPopupState = calendarExportPopupState;
root.handleCalendarExportPortMessage = handleCalendarExportPortMessage;
root.syncCalendarExportPort = syncCalendarExportPort;
root.BKUI_CALENDAR_EXPORT_PORT = BKUI_CALENDAR_EXPORT_PORT;
