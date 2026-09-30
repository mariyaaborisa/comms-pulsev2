#!/usr/bin/env node
"use strict";
// Loads index.html in headless Chromium and fails on any console error or
// page error, then runs a scripted interaction to catch DOM-wiring bugs
// that a syntax check alone can't. Not part of the shipped app.
var path = require("path");
var NODE_PATH = "/opt/node22/lib/node_modules";
if (!require.resolve.paths("playwright") || !require.resolve.paths("playwright").some(function (p) { return p.indexOf(NODE_PATH) !== -1; })) {
  module.paths.push(NODE_PATH);
}
var chromium = require("playwright").chromium;

(async function () {
  var browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  var page = await browser.newPage();
  var errors = [];
  page.on("pageerror", function (e) { errors.push("pageerror: " + e.message); });
  page.on("console", function (msg) { if (msg.type() === "error") errors.push("console.error: " + msg.text()); });

  var target = process.argv[2] || "index.html";
  await page.goto("file://" + path.resolve(__dirname, "..", target));
  await page.waitForTimeout(1500);

  var hasKpis = await page.locator("#kpiGrid .kpi-tile").count();
  console.log("KPI tiles rendered:", hasKpis);

  // Fill and submit the campaign goal form
  await page.fill("#cg_name", "VSTEM Fall 2026");
  await page.selectOption("#cg_audience", "mentee");
  await page.fill("#cg_outcomeLabel", "Completed second-stage applications");
  await page.selectOption("#cg_outcomeField", "conversions");
  await page.fill("#cg_targetCount", "20");
  await page.fill("#cg_startDate", "2026-06-29");
  await page.fill("#cg_deadline", "2026-09-07");
  await page.click("#campaignForm button[type=submit]");
  await page.waitForTimeout(300);
  var summaryVisible = await page.locator("#campaignSummary").isVisible();
  console.log("Campaign summary visible after save:", summaryVisible);

  // Log an action
  await page.selectOption("#ac_type", "flyer");
  await page.fill("#ac_channel", "Instagram");
  await page.selectOption("#ac_audience", "mentee");
  await page.click("#actionForm button[type=submit]");
  await page.waitForTimeout(300);
  var actionRows = await page.locator("#actionTableBody tr").count();
  console.log("Action rows after log:", actionRows);

  // Log an outcome
  await page.fill("#oc_group", "Consortium");
  await page.fill("#oc_description", "Shared campaign in newsletter");
  await page.click("#outcomeForm button[type=submit]");
  await page.waitForTimeout(300);
  var outcomeRows = await page.locator("#outcomeTableBody tr").count();
  console.log("Outcome rows after log:", outcomeRows);

  var studyVisible = await page.locator("#studyBody").isVisible();
  console.log("Study body visible (campaign set):", studyVisible);

  console.log("");
  console.log("Console/page errors:", JSON.stringify(errors, null, 2));
  await browser.close();
  if (errors.length) process.exitCode = 1;
})();
