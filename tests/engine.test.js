#!/usr/bin/env node
"use strict";
/*
 * Extracts the CDLS-ENGINE block from index.html (same marker technique as
 * scripts/build-offline.js) and runs it under Node against fixtures, so a
 * change to the pure calculations can't silently change behavior.
 *
 * This file currently locks the v1 engine functions carried over unchanged
 * in the Pulse v2 fork (step 1 of the build order). Fixtures for v2-only
 * functions (bucketActionsByWeek, classifyWeek, progressToGoal, liftForWeek,
 * etc. -- see the architecture brief section 6) land as those functions are
 * added to the engine block in later steps.
 *
 * Usage: node tests/engine.test.js
 */
var fs = require("fs");
var path = require("path");
var assert = require("assert/strict");
var vm = require("vm");

var ROOT = path.join(__dirname, "..");

function extractEngineBlock() {
  var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  var startMarker = "// CDLS-ENGINE:START";
  var endMarker = "// CDLS-ENGINE:END";
  var startIdx = html.indexOf(startMarker);
  var endIdx = html.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) throw new Error("CDLS-ENGINE markers not found in index.html");
  return html.slice(startIdx, endIdx);
}

var EXPORTS = [
  "buildAliasToField", "CANONICAL_ALIASES", "CANONICAL_ALIAS_TO_FIELD", "METRICS", "OUTCOME_FIELD_OPTIONS", "TEMPLATE_CSV",
  "normalizeHeader", "toNumber", "isBlank", "formatWeekLabel", "fmt",
  "parseAnyDate", "isoWeekMondayString", "mapRow", "buildPreAggRow", "normalizeCanonicalRows",
  "aggregateToWeek", "looksCanonical", "ADAPTERS", "ADAPTER_MATCH_THRESHOLD", "detectAdapter",
  "runAdapter", "generateSampleData", "sumMetric", "growthSentence", "decodeTextBuffer",
  "validateCampaignFields", "computeFunnelForWeek", "bucketActionsByWeek", "classifyWeek",
  "outcomeSeries", "progressToGoal", "liftForWeek", "RESPONSE_WEEKS", "responseWindow",
  "channelMatch", "unattributed", "funnelByStage", "buildFindings"
];

function loadEngine() {
  var code = extractEngineBlock() + "\nmodule.exports = { " + EXPORTS.join(", ") + " };";
  var sandbox = { module: { exports: {} }, TextDecoder: TextDecoder, console: console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "cdls-engine.js" });
  return sandbox.module.exports;
}

var engine = loadEngine();
var failures = [];

function test(name, fn) {
  try {
    fn();
    console.log("  ok - " + name);
  } catch (e) {
    failures.push(name + ": " + e.message);
    console.log("  FAIL - " + name + ": " + e.message);
  }
}

console.log("CDLS-ENGINE tests");

// Sandbox-realm arrays/objects aren't `===`-compatible with the host realm's
// Array/Object constructors, so assert.deepEqual (which checks prototype
// identity) rejects a structurally-identical value from the vm sandbox
// against a host-realm literal. Round-tripping through JSON strips realm
// identity and leaves only the data, which is all these tests check.
function toPlain(x) { return JSON.parse(JSON.stringify(x)); }

// ---- normalizeHeader / toNumber / isBlank ----
test("normalizeHeader lowercases and collapses punctuation to underscores", function () {
  assert.equal(engine.normalizeHeader("  Page Reach! "), "page_reach");
  assert.equal(engine.normalizeHeader(null), "");
});
test("toNumber strips currency/percent/commas and defaults blanks to 0", function () {
  assert.equal(engine.toNumber("$1,234.5%"), 1234.5);
  assert.equal(engine.toNumber(""), 0);
  assert.equal(engine.toNumber(undefined), 0);
  assert.equal(engine.toNumber("not a number"), 0);
});
test("isBlank treats null/undefined/whitespace as blank", function () {
  assert.equal(engine.isBlank(null), true);
  assert.equal(engine.isBlank(undefined), true);
  assert.equal(engine.isBlank("   "), true);
  assert.equal(engine.isBlank("0"), false);
});

// ---- parseAnyDate / isoWeekMondayString ----
test("parseAnyDate parses an ISO date string to UTC midnight", function () {
  var d = engine.parseAnyDate("2026-08-05");
  assert.equal(d.toISOString(), "2026-08-05T00:00:00.000Z");
});
test("parseAnyDate parses a real Date object by calendar date, not timestamp", function () {
  var d = engine.parseAnyDate(new Date("2026-08-05T23:00:00-07:00"));
  assert.equal(d.toISOString(), "2026-08-06T00:00:00.000Z");
});
test("parseAnyDate returns null for unparseable input", function () {
  assert.equal(engine.parseAnyDate("not a date"), null);
  assert.equal(engine.parseAnyDate(""), null);
});
test("parseAnyDate handles an Excel serial date", function () {
  var d = engine.parseAnyDate(46000); // falls in the 20000-90000 fallback range
  // d is a Date from the vm sandbox's own realm, so instanceof against the
  // host Date constructor doesn't hold; check via toISOString instead.
  assert.equal(typeof d.toISOString, "function");
  assert.equal(d.toISOString(), "2025-12-09T00:00:00.000Z");
});
test("isoWeekMondayString returns the Monday of the containing ISO week", function () {
  assert.equal(engine.isoWeekMondayString(new Date("2026-08-05T00:00:00Z")), "2026-08-03"); // Wednesday
  assert.equal(engine.isoWeekMondayString(new Date("2026-08-03T00:00:00Z")), "2026-08-03"); // Monday itself
  assert.equal(engine.isoWeekMondayString(new Date("2026-08-09T00:00:00Z")), "2026-08-03"); // Sunday
});

// ---- mapRow / buildPreAggRow / looksCanonical ----
test("mapRow copies only aliased columns and sums duplicates onto one field", function () {
  var mapped = engine.mapRow(
    { Date: "2026-08-04", Likes: "10", Comments: "5", Email: "person@example.com" },
    engine.CANONICAL_ALIAS_TO_FIELD
  );
  assert.equal(mapped.email, undefined); // unmapped column never copied - PII stays out
  assert.equal(mapped.week, "2026-08-04");
});
test("buildPreAggRow requires channel and date, falls back reach->impressions", function () {
  assert.equal(engine.buildPreAggRow({ impressions: "100" }, "Instagram", "2026-08-04").reach, 100);
  assert.equal(engine.buildPreAggRow({ reach: "50" }, "", "2026-08-04"), null);
  assert.equal(engine.buildPreAggRow({ reach: "50" }, "Instagram", ""), null);
});
test("buildPreAggRow falls back conversions to form_submissions + new_subscribers", function () {
  var row = engine.buildPreAggRow({ form_submissions: "3", new_subscribers: "2" }, "Forms", "2026-08-04");
  assert.equal(row.conversions, 5);
});
test("a plain 'signups' column still maps to new_subscribers (conversions fallback), not the new interest_signups field", function () {
  var mapped = engine.mapRow({ date: "2026-08-04", signups: "7" }, engine.CANONICAL_ALIAS_TO_FIELD);
  assert.equal(mapped.new_subscribers, 7);
  assert.equal(mapped.interest_signups, undefined);
});
test("buildPreAggRow carries the campaign-outcome fields interest_signups/applications, defaulting to 0", function () {
  var row = engine.buildPreAggRow({ interest_signups: "40", applications: "12" }, "Forms", "2026-08-04");
  assert.equal(row.interest_signups, 40);
  assert.equal(row.applications, 12);
  var bare = engine.buildPreAggRow({ reach: "10" }, "Forms", "2026-08-04");
  assert.equal(bare.interest_signups, 0);
  assert.equal(bare.applications, 0);
});
test("looksCanonical requires both a week-like and a channel-like column", function () {
  assert.equal(engine.looksCanonical(new Set(["week", "channel"])), true);
  assert.equal(engine.looksCanonical(new Set(["week"])), false);
  assert.equal(engine.looksCanonical(new Set(["channel"])), false);
});

// ---- aggregateToWeek ----
test("aggregateToWeek sums additive metrics within a week, takes latest followers", function () {
  var rows = engine.aggregateToWeek([
    { rawdate: "2026-08-03", channel: "Instagram", reach: 100, impressions: 0, engagements: 0, followers: 900, clicks: 0, conversions: 0 },
    { rawdate: "2026-08-05", channel: "Instagram", reach: 50, impressions: 0, engagements: 0, followers: 950, clicks: 0, conversions: 0 }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].week, "2026-08-03");
  assert.equal(rows[0].reach, 150);
  assert.equal(rows[0].followers, 950); // latest by date, not sum
});
test("aggregateToWeek buckets rows from different weeks separately", function () {
  var rows = engine.aggregateToWeek([
    { rawdate: "2026-08-03", channel: "Instagram", reach: 100, impressions: 0, engagements: 0, followers: 0, clicks: 0, conversions: 0 },
    { rawdate: "2026-08-10", channel: "Instagram", reach: 200, impressions: 0, engagements: 0, followers: 0, clicks: 0, conversions: 0 }
  ]);
  assert.equal(rows.length, 2);
});
test("aggregateToWeek skips rows with an unparseable date", function () {
  var rows = engine.aggregateToWeek([
    { rawdate: "not a date", channel: "Instagram", reach: 100, impressions: 0, engagements: 0, followers: 0, clicks: 0, conversions: 0 }
  ]);
  assert.equal(rows.length, 0);
});

// ---- detectAdapter / runAdapter ----
test("detectAdapter matches an Instagram Insights export by column signature", function () {
  var headers = ["date", "reach", "accounts_reached", "impressions", "follows", "likes", "comments", "shares", "saves", "website_taps"];
  var adapter = engine.detectAdapter(headers, "instagram_export.csv");
  assert.equal(adapter && adapter.id, "instagram_insights");
});
test("detectAdapter returns null when no adapter's signature meets the threshold", function () {
  var adapter = engine.detectAdapter(["foo", "bar"], "unknown.csv");
  assert.equal(adapter, null);
});
test("runAdapter reshapes raw rows into pre-agg rows via the adapter's alias map", function () {
  var adapter = engine.ADAPTERS.filter(function (a) { return a.id === "linktree"; })[0];
  var out = engine.runAdapter(adapter, [{ date: "2026-08-04", total_views: "300", total_clicks: "40" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].channel, "Linktree");
  assert.equal(out[0].clicks, 40);
});

// ---- generateSampleData ----
test("generateSampleData is deterministic and produces 6 channels x 10 weeks", function () {
  var a = engine.generateSampleData();
  var b = engine.generateSampleData();
  assert.deepEqual(a, b); // fixed seed - no behavior change across runs
  var channels = new Set(a.map(function (r) { return r.channel; }));
  var weeks = new Set(a.map(function (r) { return r.week; }));
  assert.equal(channels.size, 6);
  assert.equal(weeks.size, 10);
});

// ---- sumMetric ----
test("sumMetric totals one field for the selected week and channel set", function () {
  var rows = [
    { week: "2026-08-03", channel: "Instagram", reach: 100 },
    { week: "2026-08-03", channel: "Facebook", reach: 50 },
    { week: "2026-08-10", channel: "Instagram", reach: 999 }
  ];
  assert.equal(engine.sumMetric(rows, "2026-08-03", new Set(["Instagram", "Facebook"]), "reach"), 150);
  assert.equal(engine.sumMetric(rows, "2026-08-03", new Set(["Instagram"]), "reach"), 100);
});
test("sumMetric returns 0 for a week with no matching rows", function () {
  var rows = [{ week: "2026-08-03", channel: "Instagram", reach: 100 }];
  assert.equal(engine.sumMetric(rows, "2026-09-01", new Set(["Instagram"]), "reach"), 0);
});

// ---- growthSentence ----
test("growthSentence describes a rise, a fall, and a flat week", function () {
  assert.match(engine.growthSentence("Reach", 150, 100), /rose 50% from last week/);
  assert.match(engine.growthSentence("Reach", 50, 100), /fell 50% from last week/);
  assert.match(engine.growthSentence("Reach", 100, 100), /held steady/);
});
test("growthSentence handles a prior week of exactly 0 (no percent to compute)", function () {
  assert.match(engine.growthSentence("Reach", 0, 0), /stayed flat at 0/);
  assert.match(engine.growthSentence("Reach", 40, 0), /is new this week/);
});

// ---- decodeTextBuffer ----
test("decodeTextBuffer reads plain UTF-8 and strips a sep=, hint line", function () {
  var buf = Buffer.from("sep=,\nweek,channel\n2026-08-04,Instagram\n", "utf8");
  var text = engine.decodeTextBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(text.indexOf("sep="), -1);
  assert.ok(text.indexOf("week,channel") === 0);
});
test("decodeTextBuffer decodes a UTF-16LE BOM buffer", function () {
  var text16 = Buffer.from("﻿week,channel\n", "utf16le");
  var text = engine.decodeTextBuffer(text16.buffer.slice(text16.byteOffset, text16.byteOffset + text16.byteLength));
  assert.ok(text.indexOf("week,channel") !== -1);
});

// ==== Pulse v2 study engine (section 6 of the architecture brief) ====

function campaignFixture(overrides) {
  return Object.assign({
    id: "camp1",
    name: "VSTEM Fall 2026",
    outcomeLabel: "Completed applications",
    outcomeField: "applications",
    targetCount: 20,
    startDate: "2026-06-29",
    deadline: "2026-09-07",
    baselinePerWeek: null
  }, overrides || {});
}
function row(week, channel, applications, extra) {
  return Object.assign({ week: week, channel: channel, reach: 0, impressions: 0, engagements: 0, followers: 0, clicks: 0, conversions: 0, applications: applications || 0, interest_signups: 0 }, extra || {});
}

// ---- bucketActionsByWeek / classifyWeek ----
test("bucketActionsByWeek assigns each action to its ISO week", function () {
  var buckets = engine.bucketActionsByWeek(
    [{ date: "2026-07-01" }, { date: "2026-07-08" }],
    engine.isoWeekMondayString
  );
  assert.deepEqual(Object.keys(buckets).sort(), ["2026-06-29", "2026-07-06"]);
});
test("classifyWeek: none / clean / stacked (fixture: two actions on the same day)", function () {
  assert.equal(engine.classifyWeek([]), "none");
  assert.equal(engine.classifyWeek([{ type: "flyer" }]), "clean");
  assert.equal(engine.classifyWeek([{ type: "flyer" }, { type: "flyer" }]), "clean"); // same type, still clean
  assert.equal(engine.classifyWeek([{ type: "flyer" }, { type: "email" }]), "stacked"); // two actions, same day, different types
});

// ---- outcomeSeries ----
test("outcomeSeries sums the outcome field by week, filtered to the campaign date range", function () {
  var campaign = campaignFixture();
  var rows = [
    row("2026-06-22", "Forms", 3), // before startDate - excluded
    row("2026-06-29", "Forms", 2), row("2026-06-29", "Newsletter", 1),
    row("2026-09-14", "Forms", 9) // after deadline - excluded
  ];
  var series = engine.outcomeSeries(rows, campaign);
  assert.deepEqual(toPlain(series), [{ week: "2026-06-29", value: 3 }]);
});
test("outcomeSeries: fixture - week with zero outcomes still isn't fabricated (no row -> no entry)", function () {
  var campaign = campaignFixture();
  var series = engine.outcomeSeries([row("2026-06-29", "Forms", 0)], campaign);
  assert.deepEqual(toPlain(series), [{ week: "2026-06-29", value: 0 }]);
});

// ---- progressToGoal ----
test("progressToGoal: fixture - first week, no prior data -> insufficient_data", function () {
  var campaign = campaignFixture();
  var series = [{ week: "2026-06-29", value: 4 }];
  var p = engine.progressToGoal(series, campaign, "2026-07-08");
  assert.equal(p.status, "insufficient_data");
  assert.equal(p.recentPacePerWeek, null);
  assert.equal(p.current, 4);
});
test("progressToGoal: fixture - goal reached", function () {
  var campaign = campaignFixture({ targetCount: 10 });
  var series = [{ week: "2026-06-29", value: 6 }, { week: "2026-07-06", value: 5 }];
  var p = engine.progressToGoal(series, campaign, "2026-07-15");
  assert.equal(p.status, "reached");
  assert.equal(p.remaining, 0);
});
test("progressToGoal: fixture - goal behind pace", function () {
  var campaign = campaignFixture({ targetCount: 100, deadline: "2026-08-03" });
  var series = [{ week: "2026-06-29", value: 1 }, { week: "2026-07-06", value: 1 }];
  var p = engine.progressToGoal(series, campaign, "2026-07-15");
  assert.equal(p.status, "behind");
  assert.equal(p.recentPacePerWeek, 1);
  assert.ok(p.paceNeededPerWeek > 1);
});
test("progressToGoal: on pace when recent pace meets what's needed", function () {
  var campaign = campaignFixture({ targetCount: 20, startDate: "2026-06-29", deadline: "2026-07-27" });
  var series = [{ week: "2026-06-29", value: 5 }, { week: "2026-07-06", value: 5 }];
  var p = engine.progressToGoal(series, campaign, "2026-07-15"); // 2 full weeks done, 2 weeks left, need 5/wk, pace is 5/wk
  assert.equal(p.status, "on_pace");
});

// ---- liftForWeek ----
test("liftForWeek: fixture - no baseline (first week, no prior data, no campaign baseline)", function () {
  var campaign = campaignFixture({ baselinePerWeek: null });
  var series = [{ week: "2026-06-29", value: 4 }];
  var result = engine.liftForWeek(series, "2026-06-29", campaign);
  assert.equal(result.lift, null);
  assert.equal(result.reason, "no_baseline");
});
test("liftForWeek falls back to campaign.baselinePerWeek with fewer than two prior weeks", function () {
  var campaign = campaignFixture({ baselinePerWeek: 3 });
  var series = [{ week: "2026-06-29", value: 4 }, { week: "2026-07-06", value: 8 }];
  var result = engine.liftForWeek(series, "2026-07-06", campaign);
  assert.equal(result.baseline, 3);
  assert.equal(result.lift.difference, 5);
});
test("liftForWeek: fixture - baseline under 5 never gets a percent", function () {
  var campaign = campaignFixture();
  var series = [{ week: "2026-06-29", value: 2 }, { week: "2026-07-06", value: 3 }, { week: "2026-07-13", value: 20 }];
  var result = engine.liftForWeek(series, "2026-07-13", campaign);
  assert.equal(result.baseline, 2.5); // mean of 2 and 3 - under 5
  assert.equal(result.lift.percent, null);
  assert.equal(result.lift.difference, 17.5);
});
test("liftForWeek reports a percent once baseline is at least 5", function () {
  var campaign = campaignFixture();
  var series = [{ week: "2026-06-29", value: 6 }, { week: "2026-07-06", value: 6 }, { week: "2026-07-13", value: 12 }];
  var result = engine.liftForWeek(series, "2026-07-13", campaign);
  assert.equal(result.baseline, 6);
  assert.equal(result.lift.percent, 100);
});

// ---- responseWindow / channelMatch / unattributed ----
test("responseWindow returns RESPONSE_WEEKS consecutive weeks starting at the action's week", function () {
  var w = engine.responseWindow("2026-06-29");
  assert.equal(w.length, engine.RESPONSE_WEEKS);
  assert.deepEqual(toPlain(w), ["2026-06-29", "2026-07-06"]);
});
test("channelMatch: fixture - missing channel in uploaded data returns matched:false", function () {
  var campaign = campaignFixture();
  var rows = [row("2026-06-29", "Newsletter", 5)];
  var result = engine.channelMatch({ channel: "Instagram" }, rows, "2026-06-29", campaign);
  assert.equal(result.matched, false);
});
test("channelMatch sums the action's channel against the window total when the channel is present", function () {
  var campaign = campaignFixture();
  var rows = [row("2026-06-29", "Instagram", 3), row("2026-06-29", "Newsletter", 2), row("2026-07-06", "Instagram", 1)];
  var result = engine.channelMatch({ channel: "Instagram" }, rows, "2026-06-29", campaign);
  assert.equal(result.matched, true);
  assert.equal(result.channelOutcomes, 4); // 3 + 1, across the 2-week window
  assert.equal(result.totalOutcomes, 6);
});
test("unattributed sums outcomes in a week from channels no action was logged against", function () {
  var campaign = campaignFixture();
  var rows = [row("2026-06-29", "Instagram", 3), row("2026-06-29", "Newsletter", 2)];
  var actions = [{ date: "2026-06-30", channel: "Instagram", type: "social" }];
  assert.equal(engine.unattributed(rows, "2026-06-29", actions, campaign), 2); // Newsletter has no action
});

// ---- funnelByStage ----
test("funnelByStage sums stage counts across the campaign's weeks via computeFunnelForWeek", function () {
  var campaign = campaignFixture();
  var rows = [
    row("2026-06-29", "Instagram", 0, { reach: 100, engagements: 20, clicks: 10, conversions: 2 }),
    row("2026-07-06", "Instagram", 0, { reach: 200, engagements: 40, clicks: 20, conversions: 4 }),
    row("2026-09-14", "Instagram", 0, { reach: 999, engagements: 999, clicks: 999, conversions: 999 }) // out of range
  ];
  var f = engine.funnelByStage(rows, campaign);
  assert.equal(f.reach, 300);
  assert.equal(f.clicks, 30);
  assert.equal(f.reachToEngagement, 60 / 300);
});

// ---- buildFindings ----
test("buildFindings: fixture - stacked week produces one not_testable finding naming the actions, not per-action claims", function () {
  var campaign = campaignFixture({ startDate: "2026-06-29", deadline: "2026-08-03" });
  var rows = [row("2026-06-29", "Instagram", 8), row("2026-07-06", "Instagram", 8), row("2026-07-13", "Instagram", 20)];
  var actions = [
    { id: "a1", campaignId: "camp1", date: "2026-07-13", type: "flyer", channel: "Instagram" },
    { id: "a2", campaignId: "camp1", date: "2026-07-14", type: "email", channel: "Instagram" }
  ];
  var result = engine.buildFindings({ rows: rows, actions: actions, campaign: campaign, today: "2026-07-20" });
  var stacked = result.findings.filter(function (f) { return f.type === "not_testable" && f.week === "2026-07-13"; });
  assert.equal(stacked.length, 1);
  assert.match(stacked[0].text, /flyer/);
  assert.match(stacked[0].text, /email/);
});
test("buildFindings never writes causal wording", function () {
  var campaign = campaignFixture({ startDate: "2026-06-29", deadline: "2026-08-03" });
  var rows = [row("2026-06-29", "Instagram", 8), row("2026-07-06", "Instagram", 8), row("2026-07-13", "Instagram", 20)];
  var actions = [{ id: "a1", campaignId: "camp1", date: "2026-07-13", type: "flyer", channel: "Instagram" }];
  var result = engine.buildFindings({ rows: rows, actions: actions, campaign: campaign, today: "2026-07-20" });
  var allText = result.findings.map(function (f) { return f.text; }).join(" ") + " " + result.limits.join(" ");
  assert.doesNotMatch(allText, /\bcaused\b|\bbecause of\b|\bled to\b/i);
});
test("buildFindings: fixture - missing channel in uploaded data surfaces as a limit", function () {
  var campaign = campaignFixture({ startDate: "2026-06-29", deadline: "2026-08-03" });
  var rows = [row("2026-06-29", "Instagram", 8)];
  var actions = [{ id: "a1", campaignId: "camp1", date: "2026-06-30", type: "email", channel: "Newsletter" }];
  var result = engine.buildFindings({ rows: rows, actions: actions, campaign: campaign, today: "2026-07-20" });
  assert.ok(result.limits.some(function (l) { return l.indexOf("Newsletter") !== -1; }));
});
test("buildFindings never states a percentage when the underlying baseline is under 5", function () {
  var campaign = campaignFixture({ startDate: "2026-06-29", deadline: "2026-08-03" });
  var rows = [row("2026-06-29", "Instagram", 2), row("2026-07-06", "Instagram", 3), row("2026-07-13", "Instagram", 20)];
  var actions = [{ id: "a1", campaignId: "camp1", date: "2026-07-13", type: "flyer", channel: "Instagram" }];
  var result = engine.buildFindings({ rows: rows, actions: actions, campaign: campaign, today: "2026-07-20" });
  var associated = result.findings.filter(function (f) { return f.type === "associated" && f.week === "2026-07-13"; });
  assert.equal(associated.length, 1);
  assert.doesNotMatch(associated[0].text, /%/);
});

console.log("");
if (failures.length) {
  console.log(failures.length + " failing:");
  failures.forEach(function (f) { console.log("  - " + f); });
  process.exitCode = 1;
} else {
  console.log("all passing");
}
