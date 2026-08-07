# BetterKnightsUI

Browser extension that improves UCF myUCF student self-service, starting with class search and expanding to post-enrollment schedule tools.

## Language

**Enrolled Schedule**:
The set of classes a student is registered for in the current term — not search results or shortlisted sections.
_Avoid_: Search results, planned schedule, cart

**Calendar Export**:
A single `.ics` download of the full Enrolled Schedule (registered Meetings only) from My Class Schedule list view, imported by the student's calendar app as one recurring event per Meeting. Titles look like `COP 4600 Lecture`; descriptions carry class number, instructors, and mode. No alarms in the file. Time zone is America/New_York. Offered on the page and in the extension popup when that page is open. Re-exports use stable event IDs so a later import can update prior events; skipped non-Exportable Meetings are explained in a page toast/banner.
_Avoid_: Copy for AI, share link, screenshot, per-app calendar API, Google deep link, Weekly Schedule scraping (v1), default reminders

**Exportable Meeting**:
A Meeting with concrete days, start/end time, and a usable date range. TBA / untimed online / missing-range Meetings are skipped from Calendar Export; the student is told to export again once those are announced.
_Avoid_: Partial event, placeholder event, all-day stub

**Meeting**:
One recurring class session pattern: days of week, start/end time, location, and the date range it runs. Calendar Export emits one calendar event per Meeting (e.g. lecture and lab are separate).
_Avoid_: Section (a section may have multiple meetings), row

**My Class Schedule**:
The myUCF page that lists the student's Enrolled Schedule (`SSR_SSENRL_LIST`), reached via Student Self Service → Student Center → Other Academics → Class Schedule (List view). Distinct from Weekly Schedule (`SS_WEEKLY_SCHEDULE`) and from class search. Home of Calendar Export.
_Avoid_: Class search, Add Classes, Weekly Schedule (v1), mySchedule Builder

**Schedule Change Check**:
Deferred. A later capability that notices the Enrolled Schedule no longer matches a previous Calendar Export.
_Avoid_: Sync, live calendar API

**Travel Time**:
Deferred. A later option to pad Meetings with commute buffers (Apple Calendar–style).
_Avoid_: Alarm, reminder
