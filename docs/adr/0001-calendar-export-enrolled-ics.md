# Calendar Export targets enrolled My Class Schedule via `.ics` only

Calendar Export is a post-enrollment feature: it runs on My Class Schedule list view (`SSR_SSENRL_LIST`), not class search, and ships as a single portable `.ics` file rather than per-app calendar APIs. Search-page export would conflict with “lock in after enroll,” and native Google/Apple/Outlook integrations would add OAuth, host permissions, and store-review surface for little gain over one importable file.
