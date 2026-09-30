# turbo-telegram

CDLS impact analysis internal tool.

This repository is forked from [Pulser](https://github.com/mariyaaborisa/fictional-funicular)
(Pulse v1), the CDLS weekly communications dashboard. It is the base for
Pulse v2: campaign effectiveness studies, built on top of the same
single-file architecture (`index.html`, no build step, no storage, counts
only). See the v2 architecture brief for the plan; v1's own README content
carries over unchanged for now and will be extended as v2 sections land.

## What it is (v1, unchanged so far)

- One HTML file (`index.html`) with the styling and code built in. There is
  no build step and no server.
- It opens straight from your computer (`file://`) or from any web host.
- Drag in CSV, TSV, or Excel exports and the sample data is replaced right
  away. Nothing you upload is saved, sent anywhere, or kept in the browser.
- `index.offline.html` is the same app with its libraries built in, rebuilt
  from `index.html` via `node scripts/build-offline.js`.

## Repository layout

```
turbo-telegram/
├── index.html              # the app (CDN version)
├── index.offline.html      # the app with libraries built in (no network calls)
├── scripts/
│   └── build-offline.js    # rebuilds index.offline.html from index.html
├── sample/
│   └── comms_template.csv  # the standard layout with example rows
├── README.md
└── LICENSE                 # MIT
```

## License

MIT, see [LICENSE](LICENSE). Bundled libraries keep their own licenses
(PapaParse, Chart.js, and jsPDF are MIT; SheetJS `xlsx` is Apache-2.0).
