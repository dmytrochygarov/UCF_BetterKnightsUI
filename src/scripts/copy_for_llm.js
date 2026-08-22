// "Copy for AI" button: sits in each course title bar and copies that course's
// whole section table to the clipboard as markdown.
//
// Injection is driven by the 200 ms scan loop (see main_script.js), so
// bkuiInjectCopyButton must stay idempotent and cheap - it guards on
// ".betterknightsui-copy-btn" and returns early once the button is present.

// Lucide "copy" and "check", inlined - the extension vendors Font Awesome only.
window.BKUI_COPY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>' +
  '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>' +
  "</svg>";

window.BKUI_CHECK_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20 6 9 17l-5-5"></path>' +
  "</svg>";

// Filled in by rateMyProfessorAPI.js as ratings resolve, keyed by the raw
// instructor name that myUCF prints (the same key the badges use).
window.bkuiRatingCache = window.bkuiRatingCache || {};

/* ------------------------------------------------------------------ */
/* Cell formatting                                                     */
/* ------------------------------------------------------------------ */

window.bkuiEscapeCell = function (text) {
  return String(text == null ? "" : text)
    .replace(/&nbsp;/g, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
};

window.bkuiFormatStatus = function (status) {
  const label = window.BKUI_LABELS.status[status];
  return label ? label : "UNKNOWN";
};

window.bkuiFormatSection = function (section) {
  if (!section) return "";
  let label = window.BKUI_LABELS.section[section.type];
  if (!label) label = section.text || "";
  const description = section.description || "";
  if (description && label) return description + " (" + label + ")";
  return description || label;
};

window.bkuiFormatMode = function (mode) {
  const label = window.BKUI_LABELS.mode[mode];
  return label ? label : "";
};

window.bkuiFormatDays = function (days) {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  if (!days) return "";
  const out = [];
  for (let i = 0; i < days.length && i < names.length; i++) {
    if (days[i] === 1) out.push(names[i]);
  }
  return out.join(", ");
};

window.bkuiFormatDaysAndTimes = function (daysAndTimes) {
  if (!daysAndTimes || daysAndTimes.length === 0) return "";
  const lines = [];
  for (let i = 0; i < daysAndTimes.length; i++) {
    const entry = daysAndTimes[i];
    if (!entry) continue;

    const parts = [];
    const days = window.bkuiFormatDays(entry.days);
    if (days) parts.push(days);
    if (entry.start_time || entry.end_time) {
      parts.push((entry.start_time || "?") + " - " + (entry.end_time || "?"));
    }

    let line = parts.join(" ");
    if (line && entry.duration) line += " (" + entry.duration + ")";
    if (line) lines.push(line);
  }
  return lines.join("; ");
};

window.bkuiFormatInstructors = function (instructors) {
  if (!instructors || instructors.length === 0) return "";
  const lines = [];
  for (let i = 0; i < instructors.length; i++) {
    const name = instructors[i];
    if (!name || name.length === 0) continue;

    // TBA is not a person - no point claiming it has no rating.
    if (isProfessorNameTBA(name)) {
      lines.push(name);
      continue;
    }

    const rating = window.bkuiRatingCache[name];
    if (!rating || !rating.avgRating) {
      lines.push(name + " (no RMP rating)");
      continue;
    }

    let line = rating.url ? "[" + name + "](" + rating.url + ")" : name;
    line += " — " + rating.avgRating + "/5";
    if (rating.numRatings) line += " (" + rating.numRatings + " ratings)";
    lines.push(line);
  }
  return lines.join("; ");
};

window.bkuiFormatRooms = function (rooms) {
  if (!rooms || rooms.length === 0) return "";
  const lines = [];
  for (let i = 0; i < rooms.length; i++) {
    const room_data = rooms[i];
    if (!room_data) continue;

    if (!room_data.building && !room_data.room) {
      if (room_data.text) lines.push(room_data.text);
      continue;
    }

    const building = (room_data.building || "").replace(/&nbsp;/g, "").trim();
    let room = (room_data.room || "").replace(/&nbsp;/g, "").trim();
    // Same leading-zero trim the rendered table does, so the copy matches the page.
    if (room && (room[0] === "0" || room[0] === "O")) room = room.substring(1);

    const line = (building + " " + room).trim();
    if (line) lines.push(line);
  }
  return lines.join("; ");
};

/* ------------------------------------------------------------------ */
/* Markdown document                                                   */
/* ------------------------------------------------------------------ */

window.bkuiBuildMarkdown = function (courseTitle, data) {
  const title = courseTitle && courseTitle.length ? courseTitle : "UCF Course";
  const today = new Date().toISOString().slice(0, 10);

  let md = "# " + title + "\n\n";
  md +=
    "Live data for the " +
    data.length +
    " section(s) of this course in the UCF class catalog, as of " +
    today +
    ".\n";
  md +=
    "Instructor ratings are RateMyProfessors averages out of 5, with the number of ratings.\n\n";

  md +=
    "| ID | Status | Section | Mode | Days & Time | Instructor | Room | Meeting Dates |\n";
  md += "|---|---|---|---|---|---|---|---|\n";

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item) continue;

    const cells = [
      Number.isFinite(item.class) ? item.class : "",
      window.bkuiFormatStatus(item.status),
      window.bkuiFormatSection(item.section),
      window.bkuiFormatMode(item.mode),
      window.bkuiFormatDaysAndTimes(item.daysAndTimes),
      window.bkuiFormatInstructors(item.instructors),
      window.bkuiFormatRooms(item.rooms),
      item.meetingDates,
    ];

    md += "| " + cells.map(window.bkuiEscapeCell).join(" | ") + " |\n";
  }

  return md;
};

/* ------------------------------------------------------------------ */
/* Data lookup                                                         */
/* ------------------------------------------------------------------ */

// The parsed rows handleTable stashed on the container. Falls back to
// re-parsing the untouched PeopleSoft clone kept in .betterknightsui-old-container.
window.bkuiGetContainerData = function (container) {
  let data = $(container).data("betterknightsui-data");
  if (data && data.length) return data;

  data = [];
  $(container)
    .find(".betterknightsui-old-container")
    .find(
      'div[id^="' + window.getWinDivPrefix() + 'SSR_CLSRSLT_WRK_GROUPBOX3$"]'
    )
    .each(function () {
      const row_data = window.extractDataFromTableRow(this);
      if (row_data != null) data.push(row_data);
    });
  return data;
};

// Reorder the parsed rows to match what the user is currently looking at -
// DataTables sorts the DOM, and each row carries its index into `data`.
window.bkuiOrderDataLikeTable = function (container, data) {
  const $rows = $(container).find("table.betterknightsui-table tbody tr");
  if ($rows.length === 0) return data;

  const ordered = [];
  const used = {};
  $rows.each(function () {
    const idx = parseInt($(this).attr("data-bkui-index"), 10);
    if (!Number.isInteger(idx) || !data[idx] || used[idx]) return;
    used[idx] = true;
    ordered.push(data[idx]);
  });

  if (ordered.length !== data.length) return data;
  return ordered;
};

window.bkuiReadCourseTitle = function ($host) {
  const $clone = $host.clone();
  $clone.find(".betterknightsui-copy-btn").remove();
  return ($clone.text() || "").replace(/\s+/g, " ").trim();
};

/* ------------------------------------------------------------------ */
/* Clipboard                                                           */
/* ------------------------------------------------------------------ */

// execCommand is deprecated but it is the one path that behaves the same in a
// Chrome MV3 content script, a Firefox MV2 one and a Safari web extension, and
// it is what the share-link toast in main_script.js already ships with.
window.bkuiCopyWithExecCommand = function (text) {
  try {
    if (!document.execCommand) return false;

    const $textarea = $("<textarea></textarea>")
      .val(text)
      .attr("readonly", "readonly")
      .css({
        position: "fixed",
        top: "-9999px",
        left: "-9999px",
        opacity: 0,
      });
    $("body").append($textarea);

    const active = document.activeElement;
    $textarea[0].select();
    $textarea[0].setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");

    $textarea.remove();
    // Hand focus back so the page's own keyboard handling is undisturbed.
    if (active && active.focus) active.focus();
    return copied;
  } catch (err) {
    return false;
  }
};

// Synchronous path first, on purpose: navigator.clipboard resolves a promise,
// and Safari treats the user activation as spent by the time a .catch() runs,
// so an async fallback would be too late to recover there.
window.bkuiCopyToClipboard = function (text) {
  if (window.bkuiCopyWithExecCommand(text)) return Promise.resolve(true);

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard
        .writeText(text)
        .then(function () {
          return true;
        })
        .catch(function () {
          return false;
        });
    }
  } catch (err) {}

  return Promise.resolve(false);
};

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

window.bkuiSetButtonState = function ($btn, state) {
  const labels = {
    idle: "Copy for AI",
    done: "Copied!",
    error: "Copy failed",
  };
  const icon =
    state === "done" ? window.BKUI_CHECK_ICON_SVG : window.BKUI_COPY_ICON_SVG;

  $btn
    .html(
      icon +
        '<span class="betterknightsui-copy-btn-label">' +
        labels[state] +
        "</span>"
    )
    .toggleClass("betterknightsui-copy-btn-done", state === "done")
    .toggleClass("betterknightsui-copy-btn-error", state === "error");
};

// Where the course name and the collapse chevron live.
window.bkuiFindTitleHost = function (container) {
  const $label = $(container)
    .find(
      'div[id^="' + window.getWinDivPrefix() + 'SSR_CLSRSLT_WRK_GROUPBOX2GP"]'
    )
    .first();
  if ($label.length > 0) {
    const $cell = $label.closest("td");
    return $cell.length > 0 ? $cell : $label;
  }

  const $arrow = $(container)
    .find("a.PTCOLLAPSE_ARROW, a.PTEXPAND_ARROW")
    .first();
  if ($arrow.length > 0) {
    const $cell = $arrow.closest("td");
    if ($cell.length > 0) return $cell;
  }

  return null;
};

window.bkuiInjectCopyButton = function (container, isActive) {
  const $existing = $(container).find(".betterknightsui-copy-btn");
  if ($existing.length > 0) {
    $existing.css("display", isActive ? "" : "none");
    return;
  }
  if (!isActive) return;
  // Nothing worth copying until the replacement table has been built.
  if ($(container).find(".betterknightsui-new-container").length === 0) return;

  const $host = window.bkuiFindTitleHost(container);
  if (!$host) return;

  const $btn = $(
    '<button type="button" class="betterknightsui-copy-btn" ' +
      'title="Copy this course table as markdown for an AI"></button>'
  );
  window.bkuiSetButtonState($btn, "idle");

  $btn.on("click", function (event) {
    // The title bar is PeopleSoft's collapse toggle - don't let the click reach it.
    event.preventDefault();
    event.stopPropagation();

    let data = window.bkuiGetContainerData(container);
    if (!data || data.length === 0) {
      window.bkuiSetButtonState($btn, "error");
      setTimeout(function () {
        window.bkuiSetButtonState($btn, "idle");
      }, 2000);
      return;
    }
    data = window.bkuiOrderDataLikeTable(container, data);

    const title = window.bkuiReadCourseTitle($host);
    const markdown = window.bkuiBuildMarkdown(title, data);

    Promise.resolve(window.bkuiCopyToClipboard(markdown)).then(function (ok) {
      window.bkuiSetButtonState($btn, ok ? "done" : "error");
      setTimeout(function () {
        window.bkuiSetButtonState($btn, "idle");
      }, 2000);
    });
  });

  $host.addClass("betterknightsui-copy-title-host").append($btn);
};
