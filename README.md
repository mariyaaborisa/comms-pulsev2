# Pulse 

A CDLS impact analysis internal tool. Reports weekly metrics (v1) and,
since Pulse v2, tells you whether a specific campaign worked toward its
goal, what seems to have contributed, and what you can't see.

Forked from [Pulser](https://github.com/mariyaaborisa/fictional-funicular)
(Pulse v1), the CDLS weekly communications dashboard. Same architecture
throughout: one HTML file, no build step, no server, no accounts, nothing
stored. Refresh the page and you're back to sample data.

## What it is

- One HTML file (`index.html`) with the styling and code built in. No
  build step, no server. Opens straight from your computer (`file://`)
  or from any web host (GitHub Pages: push, then Settings → Pages →
  deploy from the default branch, root folder).
- `index.offline.html` is the same app with its libraries built in, for a
  machine with no internet or a locked-down network. Rebuild it after
  editing `index.html` with `node scripts/build-offline.js`.
- Nothing you enter is saved, sent anywhere, or kept in the browser: no
  `localStorage`, `sessionStorage`, cookies, or network calls that carry
  your data. A refresh clears everything back to sample data. The only
  way anything survives a session is the study file you explicitly
  export (see below) — you keep that file yourself.
- Counts only, never personal details. Upload totals, not the people
  behind them; a name or email column you don't map to a field is never
  read past detection, on every ingestion path including the campaign
  action log.

## The campaign study (Pulse v2)

Pulse v1 answers "how are we doing" (reach, clicks, conversions, by
channel, by week). Pulse v2 answers a different question for one
specific campaign: **did it work, what seems to have contributed, and
what could we not see.**

The workflow, top to bottom on the page:

1. **Campaign goal** — a structured goal, not free text: what you're
   counting (which uploaded field), a target, a date window, and
   optionally a pre-launch baseline and a secondary rate (e.g.
   applications out of interest sign-ups).
2. **Action log** — log what you did (flyer, email, social post, event,
   reminder, word of mouth, ...), one dropdown pick and a date, in under
   ten seconds. Backfill is fine.
3. **Import data** — the same upload flow as v1's metrics, now also
   showing how many uploaded rows fall inside the campaign's date
   window.
4. **Study** — goal status (reached / on pace / behind / not enough
   data yet), the funnel for the campaign's date range, a list of
   findings, and a list of limits (what the data can't show you).
   Findings are editable before you export.
5. **Outcomes log** — a simple table any CDLS group can add a
   non-metric contribution to (a mention in a partner newsletter, a
   sign-up drive at an event) without touching the metrics upload at all.
6. **Legacy views** — the original v1 dashboard (KPI tiles, growth
   chart, funnel, detail table, Format Mix), unchanged, below the fold.

### What a finding actually says

Findings are arithmetic over rows already in memory — not an AI call,
not a claim about cause. Every finding is one of three types:

- **Observed** — a fact in the data (progress toward the goal, a
  week-over-week change).
- **Associated** — timing lines up: an outcome count moved in the same
  week as a single, distinct action ("lines up with", "in the same week
  as", "accounted for X% of" — never "caused" or "led to").
- **Not testable** — the week had more than one kind of action logged
  (a "stacked" week — you can't tell which one moved the numbers), a
  missing channel, or a count too small to read anything into.

The study **never** states a percentage when the underlying baseline is
under 5 (small counts make percentages misleading) and **never** uses
causal wording anywhere, in the findings or the limits. Counts are too
small for this tool to support real causal inference, and it doesn't
pretend otherwise — see "Not in this version" below.

### The study file — persistence without storage

Since nothing is stored, a study travels as a file you keep. **Export
study file** downloads a JSON file (campaign, actions, outcomes, and
the aggregated weekly rows only — never your raw uploads) through a
`Blob`, the same way the PDF report and the CSV template download.
**Import study file** restores everything from that file and re-renders
once. An unrecognized `schemaVersion` is rejected with a plain-language
message rather than silently misreading the file. Along with the PDF
report (which now includes a study section built from the same
functions the on-screen study is), the study file is the handoff
artifact you give the next person or cohort.

### Comms Impact Tracker

A CDLS-authored tracking sheet — not a raw platform export — recognized
alongside the Meta/Facebook, Instagram, LinkedIn, Linktree, and
Mailchimp-style adapters. It logs per-channel weekly interest sign-ups
and completed applications against a specific campaign's outcome, rather
than the platform-level reach/engagement the other adapters carry.

## What's not tracked by the canonical schema, and why

The canonical row shape (one row per channel per ISO week) now carries
two additional optional fields beyond v1's reach/impressions/
engagements/followers/clicks/conversions:

- `interest_signups` — a campaign's rate denominator (e.g. "applications
  out of interest-list sign-ups").
- `applications` — a campaign's outcome field (e.g. completed
  second-stage applications).

A plain `signups` column still maps to v1's `new_subscribers` →
conversions fallback, unchanged — the new `interest_signups` field uses
its own alias names (`interest_signups`, `interest_sign_ups`) so it never
collides with that existing behavior.

## Not in this version

Everything v1 already didn't do (ad-spend/paid-campaign attribution,
cross-platform de-duplicated unique reach, live API pulls, more than one
person working at once, anything server-side), plus, specific to the
study: no accounts, no server, no database; no form-to-event matching;
no social follower growth or content engagement rate in the default
view; and — deliberately — **no automatic causal inference or
significance testing.** Counts are too small, and the tool must not
imply rigor it can't support.

## Open questions for CDLS leadership

Carried over from the architecture brief, still open:

- Response window length (currently 2 weeks, `RESPONSE_WEEKS` in
  `index.html`) and the baseline rule (currently the mean of the prior 2
  weeks) — both should be tuned once real VSTEM data is in.
- Which row field holds the VSTEM outcome (completed second-stage
  applications — currently mapped to the `applications` field), and
  whether the interest form should add a "How did you hear about this?"
  field to make word of mouth countable.
- Whether findings text should stay rules-only, or whether an owner
  should be able to add free-text findings of their own.
- Which CDLS program lines beyond the Consortium and VSTEM should show
  up as `group` values in the outcomes log.

## Handoff notes for the next cohort

Comms turns over roughly every 10 weeks; this tool is built to outlast
its current owner. A few things worth knowing before you touch it:

- **Everything lives in `index.html`.** One `<script>` tag, one IIFE.
  There's no build step for the app itself — only `index.offline.html`
  needs regenerating (`node scripts/build-offline.js`) after an edit,
  and only if you want the offline build to reflect the change.
- **The `CDLS-ENGINE` block is the one place with no DOM access.**
  Everything between `// CDLS-ENGINE:START` and `// CDLS-ENGINE:END` is
  pure: data in, data out, nothing touching `document` or reading
  `state` directly. `tests/engine.test.js` extracts exactly that block
  and runs it under Node with `node tests/engine.test.js` — run it after
  any change in that block, or any change that might affect it.
  Everything below the engine block (rendering, ingestion, the PDF) is
  expected to call into the engine rather than reimplement its math.
- **Report interpretation, adapter signatures, and the study's tunable
  numbers are each in one named block** (`INTERP_*` constants,
  `// ---------- Platform adapters ----------`, `RESPONSE_WEEKS`), so a
  wording tweak or a platform's renamed export column doesn't require
  touching rendering or ingestion code elsewhere.
- **`scripts/smoke.js`** (not part of the shipped app) loads
  `index.offline.html` headless in Playwright and exercises the goal
  form, action log, outcome log, and study rendering, failing on any
  console or page error. Useful for catching DOM-wiring bugs the Node
  engine tests can't reach — run it with
  `node scripts/smoke.js index.offline.html` after any UI-facing change.
- **If you add a platform adapter,** give it a `signature` (normalized
  header names) that doesn't overlap with the canonical week/channel
  aliases in `CANONICAL_ALIASES`, or `looksCanonical()` will claim the
  file first and your adapter will never run — see the comment on the
  Comms Impact Tracker adapter for a worked example.
- **If you extend this tool:** keep the privacy model in place. Adding
  an account, a stored data set, a server, or any kind of phone-home
  breaks the whole reason this tool exists instead of a hosted
  dashboard, and should be flagged in review.

## Repository layout

```
turbo-telegram/
├── index.html              # the app (CDN version)
├── index.offline.html      # the app with libraries built in (no network calls)
├── scripts/
│   ├── build-offline.js    # rebuilds index.offline.html from index.html
│   └── smoke.js            # dev-only Playwright smoke test, not part of the app
├── tests/
│   └── engine.test.js      # extracts and tests the CDLS-ENGINE block under Node
├── sample/
│   └── comms_template.csv  # the standard layout with example rows
├── README.md
└── LICENSE                 # MIT
```

## License

MIT, see [LICENSE](LICENSE). Bundled libraries keep their own licenses
(PapaParse, Chart.js, and jsPDF are MIT; SheetJS `xlsx` is Apache-2.0).
