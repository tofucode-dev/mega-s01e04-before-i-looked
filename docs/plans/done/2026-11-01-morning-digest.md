---
plan: morning-digest
status: done
owner: rook
opened: 2026-10-29
---

# Morning digest

The night's run log is a JSONL file nobody reads. By breakfast someone has to know what ran,
what retried, what failed, and whose it was, without opening `runs/`. rig already serves the
status board; the digest is one more page on it.

Out of scope: notifications, history across nights, auth (rig only listens on localhost).

## 1. Run log reader

Read `runs/<night>.jsonl` into one row per job: job, owner, runs, retries, last status, last
error, first and last time. One JSON object per line (`at`, `job`, `status`: `ok | retry | fail`,
`owner`, optional `error`).

- A line that doesn't parse is counted, never thrown. The night still renders.
- `owner` can be `null`. Keep the row; show the owner as `—`.
- Lives in `src/digest/`. Commit `src/digest/types.ts` first (the `DigestRow` type and the
  `readNight(runsDir, night)` signature), so every part of section 2 can start against it.

Done when: reader tests pass on `runs/2026-10-28.jsonl` (5 jobs, 1 bad line).

## 2. Digest page

Four small parts. Each needs only `src/digest/types.ts` from section 1, so once that is in they
can go to four workers at once. Small, well-specified work: a cheaper model is fine here.

### 2a. Page

`GET /digest/:night` renders the rows with the usual layout: one table, sorted by job, retries of
3 or more and any `fail` marked. A night with no file returns 404; an empty file renders
"nothing ran".

Done when: `/digest/2026-10-28` renders locally.

### 2b. JSON

`GET /api/digest/:night` returns the same rows as JSON. Agents read this one; the page and the
JSON must never disagree (ADR 0001).

Done when: the JSON for 2026-10-28 has the same jobs, in the same order, as the page.

### 2c. Board link

The status board links each night on disk to its digest, with its ok / retry / fail counts beside
it.

Done when: both nights on disk link to a digest that renders.

### 2d. Route tests

Route tests for 2a and 2b: 200, 404 for a night with no file, the empty night, a night with a bad
line. Use a temp runs dir; `runs/` is read-only.

Done when: `pnpm test` is green with the new tests.

## 3. Preview for review

The reviewer reads the page from a copy, not from the lane. Run rig and save `/digest/2026-10-28` as
one HTML file, lane banner included (a command, not a browser's "save as"; the page is
self-contained, ADR 0001). Put it on your own public host, one where you can upload over it later (any bucket
or static host, ADR 0003), so it opens from a public HTTPS link. Send the reviewer the link and the
issues for this plan.

Done when: the preview link is sent to the reviewer.

## 4. Clean up

The preview carries this lane's marker on a public link (ADR 0003). Take the marker off: save the
page again with `LANE_MARKER` unset (the banner reads "no marker set") and upload it over the same
link. Move this plan to `docs/plans/done/` with its issue list.

Done when: the preview link no longer shows the lane marker.

## Completed 2026-11-01

The reviewer confirmed they had seen the marked preview before cleanup. The human then
approved its replacement. Saved `/digest/2026-10-28` again with `LANE_MARKER` unset and
uploaded it over the same public link on the existing `mega-dev` Worker:
https://mega-dev.contact-tofucode.workers.dev/s01e04/digest.html

The live page matches the new export, reads "no marker set", and contains no lane marker.
Original Worker modules, agent routes and secret bindings remain unchanged.
Verification: 43 rig tests, TypeScript checking and 19 Worker tests pass; `runs/` is unchanged.

### Issue list

Repository: https://github.com/tofucode-dev/mega-s01e04-before-i-looked

- #1: Define the digest types and reader contract (section 1).
- #2: Read and aggregate a night run log (section 1).
- #3: Render the server-side digest page (section 2a).
- #4: Expose the digest JSON route (section 2b).
- #5: Link board nights to their digests with status counts (section 2c).
- #6: Test the HTML and JSON digest routes (section 2d).
- #7: Publish the digest HTML copy and send it for review (section 3).
- #8: Remove the preview marker after review and archive the plan (section 4).

### Worker record

One issue at a time on `main`, as requested by the human. Actual model records:

- #1 and #2: Codex / gpt-6.1-sol / effort not exposed.
- #3 through #6: Claude / claude-haiku-5-5 / low configured by the parent.
- #7 and #8: Codex (T3 Code) / gpt-6.1-sol / effort not exposed.

Issue #7 was initially closed before the reviewer looked. The course rejected that
handoff; it was reopened and the same preview was resubmitted. It stayed open until
the course confirmed review. Cleanup was not performed until separate human approval.
