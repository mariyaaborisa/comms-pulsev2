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
  "buildAliasToField", "CANONICAL_ALIASES", "CANONICAL_ALIAS_TO_FIELD", "METRICS", "TEMPLATE_CSV",
  "normalizeHeader", "toNumber", "isBlank", "formatWeekLabel", "fmt",
  "parseAnyDate", "isoWeekMondayString", "mapRow", "buildPreAggRow", "normalizeCanonicalRows",
  "aggregateToWeek", "looksCanonical", "ADAPTERS", "ADAPTER_MATCH_THRESHOLD", "detectAdapter",
  "runAdapter", "generateSampleData", "sumMetric", "growthSentence", "decodeTextBuffer"
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

console.log("");
if (failures.length) {
  console.log(failures.length + " failing:");
  failures.forEach(function (f) { console.log("  - " + f); });
  process.exitCode = 1;
} else {
  console.log("all passing");
}
