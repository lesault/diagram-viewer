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
| Hover a shape | Everything outside its lineage greys out; the right panel lists its inputs and outputs with hop counts, its draw.io properties, and the zones it sits in |
| Click a shape | Pin it, so you can move the mouse, change settings and export. `Esc` clears |
| **Upstream / Both / Downstream** (keys `u` `b` `d`) | Which direction to follow from the shape. *Both* is upstream plus downstream from that shape, so it does not leak sideways through shared hubs |
| **Hops** slider (keys `1`-`9`) or **all** | How many connections away to follow |
| Right-click a shape | Stop the trace passing through it (for example a central log bus). Right-click again to undo |
| **Shapes** tab search | Filter by label or property; click a result to jump to it |
| Scroll / drag / **Fit** | Zoom, pan, reset the view |
| **Theme** (header) | Auto, Light or Dark. In dark mode the diagram's own colours are inverted too (untick *invert diagram* to keep them) |

Lineage follows arrow direction. A connector with no arrowheads is treated as two-way.

### Connection counts

Any shape can show a small badge with its connector counts (`in 3 · out 5`). Pin the shape and tick **Show counts on this shape** in the details panel (or press `c`), or tick **Counts on all shapes** in the Shapes tab. A shape can also opt in from the file: give it a `show_counts` property set to `1` in draw.io (Edit Data). Counts always come from the full diagram, so in a service view they show how many connections a shape has beyond the ones drawn. Badges appear in the diagram, the preview and every export (SVG, PNG, PDF, and as a small label shape in the draw.io file). Two-way and arrowless connectors count in both directions.

### Layers

Complex draw.io files often keep different things on different layers (zones, services, one layer per kind of flow, notes). The **Layers** tab lists them:

- **show**: hides a layer's shapes and connectors from the diagram and from lineage. Layers hidden in the file start hidden. Use it to trace one kind of flow at a time.
- **frame in service views**: for layers whose boxes visually contain shapes from other layers (network zones, regions, trust boundaries). Layers like this are suggested automatically. In a service view, every such box that contains a selected shape is kept as a labelled frame around those shapes, showing the box's name and its draw.io properties (classification, owner, trust level...). Nested boxes become nested frames. Membership is by position: a shape belongs to the smallest box that contains its centre.

### Tidy connectors

**Tidy connectors** reroutes every connector in the main diagram around the shapes (shapes do not move): short orthogonal routes, few bends, no lines through unrelated shapes, parallel runs and shared ports fanned apart. Click again to return to the original routing. Tidied routes carry through to service views and to whole-diagram exports, and draw.io files are written with matching connection points.

### Service views

With a shape pinned, **Preview view** shows its lineage as a standalone diagram, with a panel to shape it:

- **Heading**: a title and subtitle above the diagram, so it reads without the main diagram. Defaults to `{service} — {direction} lineage ({hops})` and `{file} · {page} · {date}`; edit freely. Tokens: `{service} {direction} {hops} {file} {page} {date}`.
- **Tidy layout** re-flows the view so it reads inputs → service → outputs. In swimlane diagrams, shapes stay in their own lane and lanes keep their order. With it off, shapes keep their original positions and lanes are trimmed to fit.
- **Connector labels** are placed beside the line, clear of shapes, zone headings and each other, and drawn above everything. The tidy layout leaves room for them, and labels are written into the draw.io export at the same positions. Any label that still has no clear spot is listed under Checks.
- **Keep swimlanes**, **Zone frames**, **Zone properties** and **Highlight service** (thicker outline on the shape the view is about).

### Export

**Export...** offers, for the current service view or for the whole diagram:

| Choice | Formats |
|---|---|
| Image | PNG at 1×–4×, white or transparent background |
| Vector | SVG; PDF (opens the print dialog, choose *Save as PDF*, text stays selectable) |
| Editable | draw.io file (headings, zone frames and tidied connectors included) |

**Export all services (.zip)** produces one set of files for every connected shape (or every shape matching the search box), each with its own heading.

### Checks

The **Checks** tab reviews the main diagram. Every finding is clickable: it highlights the shapes or connectors involved and zooms to them. **Report (.md)** and **CSV** export the full list.

| Severity | Examples |
|---|---|
| Errors | Connectors attached at neither or only one end |
| Warnings | Attached by proximity only; no arrowheads (direction unknown); repeated connectors; connectors attached to containers; shapes with no label, no connectors, or sharing a label; overlapping shapes; disconnected islands; shapes outside every swimlane or zone; shapes missing a chosen property (pick one in the *Check property* menu); connectors drawn through other shapes |
| Notes | Origins and dead ends; reciprocal connectors; unlabelled connectors; hubs; single points of connectivity (removing the shape disconnects part of the diagram); empty zone boxes or layers |

## Limitations

- Shapes are drawn by the viewer, not by draw.io. Common shapes (rectangles, ellipses, diamonds, cylinders, hexagons, swimlanes) are faithful; unusual stencils fall back to a labelled rectangle, and curved connectors are drawn straight. Layout and routing of the original diagram are otherwise preserved.
- Connectors with a loose end are attached to the nearest shape within about 24 px and drawn dashed (listed under Diagnostics). Connectors that end in empty space are left out of lineage.
- Tidy layout orders swimlanes as in the original diagram and does not rearrange them to reduce crossings; label overlaps on busy connectors are possible.
- Zones are recognised by position, so a shape half outside a box belongs to it only if its centre is inside. Boxes on frame layers that contain no selected shape are left out; other shapes on those layers (notes, legends) are not carried into service views.
- PDF export uses the browser's print dialog, so pages are set by the browser's print settings. Dark mode inverts the on-screen diagram only; exports are always light.
- Swimlanes with the header on top (side-by-side columns) use the same code as left-header lanes but have had less testing.

## Files

| Path | Purpose |
|---|---|
| `dist/viewer.html` | **The deliverable.** Everything inlined; this is the only file needed |
| `src/` | Source: `xml`, `loader`, `model`, `graph`, `context` (layers, zones), `subset` (sub-views, zone frames), `render`, `router` (connector tidy), `tidy` (service-view layout), `diagnose` (checks), `export`, `app`, plus `index.html` and `style.css` |
| `vendor/` | Inlined libraries: pako (inflate), elkjs (layout), jszip (zip) |
| `samples/` | `security.drawio` (small); `cyber-dataflow.drawio` (40 services in 9 swimlanes, built by `generate-cyber.mjs`); `layered-network.drawio` (multi-layer: zones, services, three flow layers, a hidden draft layer; built by `generate-layers.mjs`) |
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

Filter and colour by metadata, path finder between two services, collapsible zones, diff between two versions of a diagram, shareable view state in the URL.

## Licence

Lineage Viewer is released under the **MIT licence** (`LICENSE`), copyright (c) 2026 Lesault.

It includes three unmodified open-source libraries, inlined into `dist/viewer.html`: **pako** (MIT and Zlib), **JSZip** (used under MIT) and **ELK / elkjs** (EPL-2.0). Their copyright notices and licence texts are in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md); provenance and checksums for each vendored file are in [`vendor/README.md`](vendor/README.md). `viewer.html` carries the same notices inside it (the **Licences** button), so the file can be passed on by itself.

This is an independent tool. It is not affiliated with, endorsed by, or derived from code of draw.io / diagrams.net or JGraph; it reads the draw.io file format only. draw.io is a trademark of its owner, and other product names used in the sample diagrams (for example AWS, Azure, Microsoft 365, Kafka, SIEM vendors) are used only descriptively and belong to their owners.
