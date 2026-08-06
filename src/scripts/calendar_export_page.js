"use strict";

/**
 * My Class Schedule page UI for Calendar Export (#5).
 * Extract → build → .ics download + skip toast. Shared runCalendarExport
 * is also the hook for popup (#6).
 *
 * Content-script globals; Node tests require() the pure helpers.
 */

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
 * Idempotent page control. Guard: .betterknightsui-calendar-export-btn.
 * Honors extension enable/disable like other chrome.
 * @param {boolean} isEnabled
 */
function injectCalendarExportControl(isEnabled) {
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

const root = typeof window !== "undefined" ? window : globalThis;
root.formatCalendarExportToast = formatCalendarExportToast;
root.calendarExportFilename = calendarExportFilename;
root.downloadCalendarIcs = downloadCalendarIcs;
root.runCalendarExport = runCalendarExport;
root.injectCalendarExportControl = injectCalendarExportControl;
