#!/usr/bin/env node
/*
 * Regenerates index.offline.html from index.html by inlining the pinned
 * libraries (PapaParse, Chart.js, SheetJS xlsx, jsPDF) so the offline build
 * makes zero external network requests. Also strips the CDN-only Google
 * Fonts block (index.html's --font-heading/--font-body override + <link>
 * tags), leaving the base :root's system font stack as the only definition
 * -- per the project rule that the offline build has no Google Fonts
 * dependency and looks the same on every machine regardless of what's
 * locally installed.
 *
 * Usage:  node scripts/build-offline.js
 * Requires: npm and tar on PATH, and network access to the npm registry
 *           (only at build time -- the generated file itself is offline).
 */
"use strict";
var fs = require("fs");
var path = require("path");
var os = require("os");
var cp = require("child_process");

var ROOT = path.join(__dirname, "..");

var LIBS = [
  { name: "PapaParse", pkg: "papaparse", version: "5.4.1", distFile: "papaparse.min.js", license: "MIT" },
  { name: "Chart.js", pkg: "chart.js", version: "4.4.4", distFile: "dist/chart.umd.js", license: "MIT" },
  { name: "SheetJS xlsx", pkg: "xlsx", version: "0.18.5", distFile: "dist/xlsx.full.min.js", license: "Apache-2.0" },
  { name: "jsPDF", pkg: "jspdf", version: "2.5.2", distFile: "dist/jspdf.umd.min.js", license: "MIT" }
];

function run(cmd, args, cwd) {
  var res = cp.spawnSync(cmd, args, { cwd: cwd, stdio: "inherit" });
  if (res.status !== 0) throw new Error(cmd + " " + args.join(" ") + " failed");
}

function main() {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cdls-offline-"));

  run("npm", ["pack"].concat(LIBS.map(function (l) { return l.pkg + "@" + l.version; })), tmp);

  var inlined = LIBS.map(function (lib) {
    var dir = path.join(tmp, lib.pkg + "-pkg");
    fs.mkdirSync(dir);
    run("tar", ["xzf", path.join(tmp, lib.pkg + "-" + lib.version + ".tgz"), "-C", dir, "--strip-components=1"]);
    var src = fs.readFileSync(path.join(dir, lib.distFile), "utf8");
    return "<script>\n/* " + lib.name + " " + lib.version + " (" + lib.license + ") - inlined for offline use */\n" + src + "\n</script>\n";
  }).join("");

  var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  var fontsStart = "<!-- CDLS-BUILD:FONTS-START -->";
  var fontsEnd = "<!-- CDLS-BUILD:FONTS-END -->";
  var fontsStartIdx = html.indexOf(fontsStart);
  var fontsEndIdx = html.indexOf(fontsEnd);
  if (fontsStartIdx === -1 || fontsEndIdx === -1) throw new Error("Fonts markers not found in index.html");
  html = html.slice(0, fontsStartIdx) + html.slice(fontsEndIdx + fontsEnd.length);

  var startMarker = "<!-- CDLS-BUILD:LIBS-START -->";
  var endMarker = "<!-- CDLS-BUILD:LIBS-END -->";
  var startIdx = html.indexOf(startMarker);
  var endIdx = html.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) throw new Error("Library markers not found in index.html");

  var out = html.slice(0, startIdx) + startMarker + "\n" + inlined + html.slice(endIdx + endMarker.length);
  fs.writeFileSync(path.join(ROOT, "index.offline.html"), out);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Wrote index.offline.html (" + (out.length / 1024).toFixed(0) + " KB)");
}

main();
