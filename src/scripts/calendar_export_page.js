"use strict";

/**
 * My Class Schedule page UI for Calendar Export (#5 / #6).
 * Extract → build → .ics download + skip toast. runCalendarExport is the
 * shared pipeline for the page control and the extension popup.
 *
 * Popup messaging: the popup sends `browser.tabs.sendMessage` to the active
 * tab; the listener below answers only from the frame that actually hosts
 * My Class Schedule list view (other frames return no response), so the
 * popup needs no frameId bookkeeping and background.js stays untouched.
 *
 * Also loaded by popup.html for the pure helpers (popup state, toast text,
 * download); the message listener only registers in content-script frames.
 *
 * Wrapped in an IIFE: content scripts share one global lexical scope, so
 * top-level const/let here would collide with other files.
 */
(function () {
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
   * Content-script side of the popup message protocol. Returns null when this
   * frame should stay silent (not the schedule frame, or extension disabled)
   * so another frame — or nobody — answers.
   * @param {{ action?: string }|null|undefined} message
   * @param {{ onSchedule: boolean, enabled: boolean, runExport: function(): * }} ctx
   * @returns {Object|null}
   */
  function handleCalendarExportMessage(message, ctx) {
    if (!message || !message.action) return null;

    if (message.action === "bkuiCalendarExportProbe") {
      return ctx.onSchedule ? { onSchedule: true } : null;
    }

    if (message.action === "bkuiCalendarExportRun") {
      if (!ctx.onSchedule || ctx.enabled === false) return null;
      const result = ctx.runExport();
      if (!result) {
        return { ok: false, onSchedule: true };
      }
      return { ok: true, onSchedule: true, result };
    }

    return null;
  }

  /**
   * @param {{ exported?: number, skipped?: number }} result
   * @returns {string}
   */
  function formatCalendarExportToast(result) {
    const exported =
      result && result.exported != null ? Number(result.exported) : 0;
    const skipped =
      result && result.skipped != null ? Number(result.skipped) : 0;

    if (exported === 0 && skipped === 0) {
      return "No registered meetings found to export.";
    }

    const exportedLabel =
      exported === 1
        ? "Exported 1 meeting"
        : "Exported " + exported + " meetings";

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
   * The popup passes {download: false} and downloads the returned ics itself:
   * this frame is usually a cross-origin iframe, and Chrome blocks downloads
   * started there without a user gesture (the popup click happened in the
   * popup, not in this frame).
   * @param {{ download?: boolean }} [opts]
   * @returns {{ ics: string, exported: number, skipped: number, skips: Object[] }|null}
   */
  function runCalendarExport(opts) {
    if (typeof extractEnrolledMeetings !== "function") return null;
    if (typeof buildCalendarExport !== "function") return null;

    const meetings = extractEnrolledMeetings(document);
    const result = buildCalendarExport(meetings);
    const download = !opts || opts.download !== false;

    if (download && result.exported > 0) {
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
        "Downloads a .ics of your enrolled schedule. Re-importing later " +
        "updates or duplicates events, depending on your calendar app." +
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

  // Popup message endpoint — content-script frames only. In popup.html this
  // file loads without schedule_extract.js, so the guard skips registration.
  if (
    typeof browser !== "undefined" &&
    browser.runtime &&
    browser.runtime.onMessage &&
    typeof extractEnrolledMeetings === "function"
  ) {
    browser.runtime.onMessage.addListener(function (message) {
      const reply = handleCalendarExportMessage(message, {
        onSchedule:
          typeof isMyClassScheduleListView === "function" &&
          isMyClassScheduleListView(document),
        enabled: typeof window !== "undefined" && window.extensionEnabled !== false,
        runExport: function () {
          return runCalendarExport({ download: false });
        },
      });
      // Promise return = this frame answers; false = stay silent so the
      // schedule frame (or nobody) can. Required by the polyfill's onMessage.
      return reply ? Promise.resolve(reply) : false;
    });
  }

  const g = typeof window !== "undefined" ? window : globalThis;
  g.calendarExportPopupState = calendarExportPopupState;
  g.handleCalendarExportMessage = handleCalendarExportMessage;
  g.formatCalendarExportToast = formatCalendarExportToast;
  g.calendarExportFilename = calendarExportFilename;
  g.downloadCalendarIcs = downloadCalendarIcs;
  g.runCalendarExport = runCalendarExport;
  g.injectCalendarExportControl = injectCalendarExportControl;
})();
