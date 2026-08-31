# Tax Form Annotation Spec

A data structure — and a working reference implementation — for annotating
the boxes on a U.S. tax form, so that a completely separate application can
take that annotation plus a taxpayer's (deeply nested) data and stamp the
correct, correctly-formatted value into every box.

**Start here → [`SPEC.md`](./SPEC.md)** — the full written specification.
This README is the map; the spec is the deliverable.

**[Live browser demo →](./demo/index.html)** ([open on GitHub Pages once
enabled](#hosting-the-demo)) — edit an annotation file and taxpayer data
side-by-side and watch a mock form re-render with values stamped in
positioned boxes, live, entirely client-side.

## Why this shape

A tax form is a fixed 2-D layout. A taxpayer's data is an arbitrarily
nested tree (multiple W-2s, multiple dependents, filters like "wages from
CA employers only"). The gap between those two things — *where on the page*
a number goes, *how* it should look once it's there, and *which* value in
the tree it actually is — is what this spec fills in. Concretely, three
things had to be designed together:

1. **Positioning** — a box's location/size on a specific page, in a stated
   unit and coordinate origin, so any rendering target (PDF, canvas, SVG)
   can place it unambiguously.
2. **Formatting** — currency vs. plain number vs. SSN vs. checkbox vs. date,
   each with the punctuation/masking real tax forms actually use (e.g.
   negative amounts in parentheses).
3. **Data reference** — a small path language (JSONPath-lite) for reaching
   into nested data, including the two things a flat dot-path can't do:
   summing across a repeating list ("total wages across every W-2") and
   repeating a box once per list item ("one row per interest payer").

Full rationale, grammar, and the parts deliberately left out of v1 are in
[`SPEC.md`](./SPEC.md).

## Repo layout

```
SPEC.md                                  The specification (read this first)
schema/form-annotation.schema.json       JSON Schema — validates annotation files structurally
src/types.ts                             TypeScript type definitions ("classes" form of the spec)
src/resolver.ts                          Reference resolver: (annotation, taxpayer data) → draw instructions
demo/index.html + demo/app.js            Zero-build, client-side-only interactive demo (vanilla JS port of resolver.ts)
examples/
  form-1040-page1.annotations.json       A real (excerpted) annotated 1040 page — sum, filter, checkbox, repeat rows
  taxpayer-data.json                     Matching nested taxpayer data
  resolved-output.json                   What the resolver produces from the two files above
VIDEO_SCRIPT.md                          Script/outline for the walkthrough recording
```

## Quick start

No install needed to read the spec or open the demo. To run the TypeScript
reference resolver:

```bash
npm install
npm run typecheck        # tsc --noEmit — confirms the types are sound
npm run build             # emits dist/*.js
```

Or just open [`demo/index.html`](./demo/index.html) directly in a browser —
it has no dependencies and no build step (it's a vanilla-JS port of
`src/resolver.ts`, kept in sync with it).

To regenerate `examples/resolved-output.json` from the two example inputs:

```bash
node -e '
const TaxSpec = require("./demo/app.js");
const fs = require("fs");
const template = JSON.parse(fs.readFileSync("examples/form-1040-page1.annotations.json"));
const data = JSON.parse(fs.readFileSync("examples/taxpayer-data.json"));
fs.writeFileSync("examples/resolved-output.json", JSON.stringify(TaxSpec.resolveForm(template, data), null, 2) + "\n");
'
```

## A minimal example

Given this annotation for 1040 Line 1a...

```jsonc
{
  "id": "line1a",
  "formLine": "1040 Line 1a",
  "page": 1,
  "position": { "x": 468, "y": 214, "width": 92, "height": 14, "unit": "pt" },
  "format": { "type": "currency", "decimalPlaces": 0, "negativeStyle": "parentheses" },
  "dataBinding": { "path": "$.income.w2Forms[*].box1Wages", "aggregate": "sum" }
}
```

...and this taxpayer data:

```jsonc
{ "income": { "w2Forms": [ { "box1Wages": 84500.0 }, { "box1Wages": 19250.75 } ] } }
```

...a conforming resolver produces:

```jsonc
{ "id": "line1a", "page": 1, "x": 468, "y": 214, "width": 92, "height": 14,
  "text": "$103,751", "align": "right" }
```

That draw instruction is everything a rendering layer needs — pass it to
`pdf-lib`/`PyPDF`/`reportlab`/`<canvas>`/print CSS, whatever the renderer's
proprietary stack happens to be. The spec never dictates the renderer.

## Hosting the demo

The demo is static — enable GitHub Pages on this repo (Settings → Pages →
Deploy from branch → `/` root or `/demo`) and it's live with no build step,
or just open `demo/index.html` locally.

## Scope notes

What's covered, and what was deliberately left out for v1 (arithmetic
bindings, pagination, localization, etc.), is in [`SPEC.md` §11–12](./SPEC.md#11-explicitly-out-of-scope-v1).
