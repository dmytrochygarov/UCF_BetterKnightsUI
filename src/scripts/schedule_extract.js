"use strict";

/**
 * My Class Schedule (list view) → Meetings[] for Calendar Export.
 * No download / button UI — see issue #4 / CONTEXT.md.
 *
 * Content-script global; Node tests require() and read from globalThis.
 *
 * Wrapped in an IIFE: content scripts share one global lexical scope, so
 * top-level const/let here would collide with other files.
 */
(function () {
  const DAY_CODES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  /**
   * @param {Document|ParentNode} [root]
   * @returns {boolean}
   */
  function isMyClassScheduleListView(root) {
    const doc = root || (typeof document !== "undefined" ? document : null);
    if (!doc || typeof doc.querySelector !== "function") return false;

    // List view shows CLASS_MTG_VW meeting grids inside per-course
    // DERIVED_REGFRM1_DESCR20 groupboxes. Weekly Schedule, class search, and
    // other enrollment pages (drop/swap) use different markup.
    if (!doc.querySelector('table[id^="CLASS_MTG_VW$scroll$"]')) return false;
    if (!doc.querySelector('div[id^="win0divDERIVED_REGFRM1_DESCR20$"]')) {
      return false;
    }
    if (doc.querySelector('div[id^="win0divSSR_CLSRSLT_WRK_GROUPBOX2"]')) {
      return false;
    }
    return true;
  }

  /**
   * @param {Document|ParentNode} [root]
   * @returns {Object[]} Meetings shaped for buildCalendarExport
   */
  function extractEnrolledMeetings(root) {
    const doc = root || (typeof document !== "undefined" ? document : null);
    if (!isMyClassScheduleListView(doc)) return [];

    const courses = doc.querySelectorAll(
      'div[id^="win0divDERIVED_REGFRM1_DESCR20$"]'
    );
    const meetings = [];

    courses.forEach((courseEl) => {
      const index = courseIndexFromId(courseEl.id);
      if (index == null) return;
      if (!isRegisteredStatus(statusText(doc, index))) return;

      const titleEl = courseEl.querySelector("td.PAGROUPDIVIDER");
      const identity = parseCourseTitle(titleEl ? textContent(titleEl) : "");
      if (!identity) return;

      const rows = courseEl.querySelectorAll('tr[id^="trCLASS_MTG_VW$"]');
      let carry = {
        classNumber: null,
        meetingType: null,
        instructors: [],
      };

      rows.forEach((row) => {
        const parsed = parseMeetingRow(row, identity, carry);
        if (!parsed) return;
        carry = {
          classNumber: parsed.classNumber,
          meetingType: parsed.meetingType,
          instructors: parsed.instructors,
        };
        meetings.push(parsed);
      });
    });

    return meetings;
  }

  function courseIndexFromId(id) {
    const m = String(id).match(/DERIVED_REGFRM1_DESCR20\$(\d+)$/);
    return m ? m[1] : null;
  }

  function statusText(doc, index) {
    const el =
      (typeof doc.getElementById === "function" &&
        doc.getElementById("STATUS$" + index)) ||
      doc.querySelector('[id="STATUS$' + index + '"]');
    return el ? textContent(el) : "";
  }

  /** Enrolled only — waitlisted / dropped / withdrawn are not export candidates. */
  function isRegisteredStatus(status) {
    const s = String(status || "")
      .replace(/\u00a0/g, " ")
      .trim()
      .toLowerCase();
    return s === "enrolled";
  }

  /**
   * "COP 4600 - Operating Systems" → { subject, catalogNumber }
   * @returns {{ subject: string, catalogNumber: string } | null}
   */
  function parseCourseTitle(title) {
    const cleaned = String(title || "")
      .replace(/\u00a0/g, " ")
      .replace(/&amp;/g, "&")
      .trim();
    if (!cleaned) return null;
    const m = cleaned.match(/^([A-Za-z]{2,8})\s+([A-Za-z0-9]+)\b/);
    if (!m) return null;
    return { subject: m[1].toUpperCase(), catalogNumber: m[2] };
  }

  function parseMeetingRow(row, identity, carry) {
    const classRaw = fieldText(row, "DERIVED_CLS_DTL_CLASS_NBR");
    const typeRaw = fieldText(row, "MTG_COMP");
    const schedRaw = fieldText(row, "MTG_SCHED");
    const locRaw = fieldText(row, "MTG_LOC");
    const instrRaw = fieldHtml(row, "DERIVED_CLS_DTL_SSR_INSTR_LONG");
    const datesRaw = fieldText(row, "MTG_DATES");
    const modeRaw =
      fieldText(row, "INSTRUCT_MODE_DESCR") || fieldText(row, "SSR_INSTR_MODE");

    // Skip empty padding rows.
    if (!schedRaw && !classRaw && !datesRaw && !locRaw) return null;

    const classNumber = classRaw || carry.classNumber;
    if (!classNumber) return null;

    const meetingType = typeRaw || carry.meetingType || "Meeting";
    const instructors = instrRaw
      ? parseInstructors(instrRaw)
      : carry.instructors.slice();
    const schedule = parseMtgSched(schedRaw);
    const range = parseMtgDates(datesRaw);
    const mode = parseModeLabel(modeRaw);

    /** @type {Object} */
    const meeting = {
      subject: identity.subject,
      catalogNumber: identity.catalogNumber,
      meetingType,
      classNumber: String(classNumber),
      instructors,
      days: schedule.days,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      location: locRaw || undefined,
      rangeStart: range.rangeStart,
      rangeEnd: range.rangeEnd,
    };
    if (mode) meeting.mode = mode;
    return meeting;
  }

  function fieldText(row, idPrefix) {
    const el = row.querySelector('[id^="' + idPrefix + '"]');
    if (!el) return "";
    return normalizeBlank(textContent(el));
  }

  function fieldHtml(row, idPrefix) {
    const el = row.querySelector('[id^="' + idPrefix + '"]');
    if (!el) return "";
    return normalizeBlank(
      String(el.innerHTML || "")
        .replace(/&nbsp;/gi, " ")
        .replace(/\u00a0/g, " ")
        .trim()
    );
  }

  function normalizeBlank(s) {
    const t = String(s || "")
      .replace(/\u00a0/g, " ")
      .trim();
    return t === "" ? "" : t;
  }

  function textContent(el) {
    return String(el.textContent || "")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function parseInstructors(htmlOrText) {
    return String(htmlOrText)
      .split(/<br\s*\/?>/i)
      .map((part) =>
        part
          .replace(/<[^>]+>/g, "")
          .replace(/,/g, " ")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);
  }

  /**
   * "MoWe 10:30AM - 11:45AM" | "TuTh 9:00 AM - 10:15 AM" | "TBA"
   */
  function parseMtgSched(raw) {
    const s = normalizeBlank(raw);
    if (!s || /^TBA$/i.test(s)) {
      return { days: [], startTime: null, endTime: null };
    }

    const m = s.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)+)\s+(.+?)\s*-\s*(.+)$/i);
    if (!m) {
      return { days: [], startTime: null, endTime: null };
    }

    const days = [];
    const dayPart = m[1];
    for (let i = 0; i < dayPart.length; i += 2) {
      const code =
        dayPart.charAt(i).toUpperCase() + dayPart.charAt(i + 1).toLowerCase();
      if (DAY_CODES.includes(code) && !days.includes(code)) days.push(code);
    }

    return {
      days,
      startTime: normalizeClock(m[2]),
      endTime: normalizeClock(m[3]),
    };
  }

  /** Normalize to "h:mm AM/PM" for the Calendar Export builder. */
  function normalizeClock(timeString) {
    const s = String(timeString || "")
      .replace(/\u00a0/g, " ")
      .trim();
    if (!s || /^TBA$/i.test(s)) return null;
    const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;
    return Number(m[1]) + ":" + m[2] + " " + m[3].toUpperCase();
  }

  /**
   * "01/12/2026 - 04/27/2026" (UCF / US MM/DD/YYYY)
   */
  function parseMtgDates(raw) {
    const s = normalizeBlank(raw);
    if (!s || /^TBA$/i.test(s)) {
      return { rangeStart: null, rangeEnd: null };
    }
    const m = s.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );
    if (!m) return { rangeStart: null, rangeEnd: null };
    return {
      rangeStart: toIso(m[3], m[1], m[2]),
      rangeEnd: toIso(m[6], m[4], m[5]),
    };
  }

  function toIso(year, month, day) {
    return (
      String(year) +
      "-" +
      String(month).padStart(2, "0") +
      "-" +
      String(day).padStart(2, "0")
    );
  }

  /**
   * Prefer human label for DESCRIPTION. Accepts "In Person (P)" or bare codes.
   */
  function parseModeLabel(raw) {
    const s = normalizeBlank(raw);
    if (!s) return undefined;
    const beforeParen = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
    return beforeParen || s;
  }

  const g = typeof window !== "undefined" ? window : globalThis;
  g.isMyClassScheduleListView = isMyClassScheduleListView;
  g.extractEnrolledMeetings = extractEnrolledMeetings;
})();
