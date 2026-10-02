# Lineage Viewer

A single-file, offline viewer for draw.io diagrams. Hover a shape to see only the shapes connected to it, follow data lineage upstream or downstream for a chosen number of hops, and export the isolated "service view" as a standalone diagram.

Built for large dataflow diagrams (for example, a cybersecurity services map drawn in swimlanes) that are too complex to read as a whole.

## Using it

1. Open `viewer.html` in Chrome, Edge, Firefox or Safari. Double-click it; no install, server or network is needed.
2. Drag a `.drawio` file onto the page, or click **Open .drawio**. Multi-page files get a tab per page. Compressed pages are supported.

**Nothing is uploaded.** The file is read and processed entirely in the browser, and the viewer makes no network requests.

### Exploring

| Action | Result |
|---|---|
| Hover a shape | Everything outside its lineage greys out; the right panel lists its inputs and outputs with hop counts and any draw.io data properties (owner, classification, ...) |
| Click a shape | Pin it, so you can move the mouse, change settings and export. `Esc` clears |
| **Upstream / Both / Downstream** (keys `u` `b` `d`) | Which direction to follow from the shape. *Both* is upstream plus downstream from that shape, so it does not leak sideways through shared hubs |
| **Hops** slider (keys `1`-`9`) or **all** | How many connections away to follow |
| Right-click a shape | Stop the trace passing through it (for example a central log bus). Right-click again to undo |
| Search box | Filter the shape list by label or metadata; click a result to jump to it |
| Scroll / drag / **Fit** | Zoom, pan, reset the view |
| **Diagnostics** (bottom left) | Connectors attached only by proximity, unattached connectors, shapes with no connections, duplicate labels |

Lineage follows arrow direction. A connector with no arrowheads is treated as two-way.

### Service views and export

With a shape pinned:

- **Preview view** shows its lineage as a standalone diagram. Swimlanes and pools containing those shapes are kept, with their labels.
- **Export...** writes **SVG**, **PNG** (2x) and **draw.io** files (the draw.io file opens and edits normally in draw.io).
  - **Tidy layout** re-flows the view so it reads as inputs -> service -> outputs. In swimlane diagrams, shapes stay in their own lane and lanes keep their order. With it off, shapes keep their original positions and the lanes are trimmed to fit.
  - **Keep zones / containers** includes the surrounding lanes, pools and zones.
  - **Export all services (.zip)** produces one set of files for every connected shape (or every shape matching the search box).

## Limitations

- Shapes are drawn by the viewer, not by draw.io. Common shapes (rectangles, ellipses, diamonds, cylinders, hexagons, swimlanes) are faithful; unusual stencils fall back to a labelled rectangle, and curved connectors are drawn straight. Layout and routing of the original diagram are otherwise preserved.
- Connectors with a loose end are attached to the nearest shape within about 24 px and drawn dashed (listed under Diagnostics). Connectors that end in empty space are left out of lineage.
- Tidy layout orders swimlanes as in the original diagram and does not rearrange them to reduce crossings; label overlaps on busy connectors are possible.
- Swimlanes with the header on top (side-by-side columns) use the same code as left-header lanes but have had less testing.

## Files

| Path | Purpose |
|---|---|
| `dist/viewer.html` | **The deliverable.** Everything inlined; this is the only file needed |
| `src/` | Source: `xml`, `loader`, `model`, `graph`, `subset`, `render`, `tidy`, `export`, `app`, plus `index.html` and `style.css` |
| `vendor/` | Inlined libraries: pako (inflate), elkjs (layout), jszip (zip) |
| `samples/` | `security.drawio` (small), `cyber-dataflow.drawio` (40 services in 9 lanes), and `generate-cyber.mjs` which regenerates the latter |
| `tests/` | Unit tests |

## Development

Requires Node 20+.

```
npm install        # elkjs is needed for the tests
node build.mjs     # writes dist/viewer.html
npm test           # node --test tests/
```

`node build.mjs path/to/other.drawio` embeds a different file behind the **Sample** button.

The build concatenates the modules (no bundler) and inlines the vendored libraries, so `dist/viewer.html` must be rebuilt after any change to `src/`.

## Planned

Filter and colour by metadata, path finder between two services, collapsible zones, diff between two versions of a diagram, CSV/markdown reports, shareable view state in the URL.
