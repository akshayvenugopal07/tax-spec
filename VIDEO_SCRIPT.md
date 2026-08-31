# Video walkthrough script (target: ≤5 minutes)

Record with the repo open in an editor (SPEC.md + examples) in one window
and `demo/index.html` open in a browser in another. Rough timing below —
adjust live, but don't chase completeness over the time cap.

## 0:00–0:30 — The problem (30s)

- "A tax form is a fixed layout of boxes. A taxpayer's data is a deeply
  nested tree — multiple W-2s, multiple dependents. The gap between them
  is what I'm specifying: given an annotation file and a taxpayer's data,
  a separate app should be able to print the right value in every box."
- Show `context.md` prompt briefly for framing, then switch to the repo.

## 0:30–1:30 — The shape of the spec (60s)

Open `SPEC.md`, scroll through structure only (don't read prose aloud):

- `FormTemplate` → array of `FieldAnnotation`.
- Point at one real `FieldAnnotation` (Line 1a) and call out its three
  jobs in one sentence each:
  - **`position`** — x/y/width/height, top-left origin, points; mention the
    PDF bottom-left conversion note in passing ("that's the renderer's job,
    not the annotator's").
  - **`format`** — currency, decimals, negative-in-parentheses — "the
    punctuation tax forms actually use."
  - **`dataBinding`** — the JSONPath-lite path + `aggregate` — this is the
    "deeply nested data" requirement.

## 1:30–2:45 — Data binding, the interesting part (75s)

Still in `SPEC.md` §6, walk through the grammar table for ~15s, then jump
to `examples/form-1040-page1.annotations.json` and point at three concrete
bindings:

1. `line1a` — `sum` aggregate across every W-2's box1Wages (one box, many
   sources).
2. `caWagesOnly` — a filter predicate, `[?(@.employerState=='CA')]`.
3. `schB_interest_row` + `repeat` — one box template, one row per interest
   payer, `@.payerName` referencing the *current* repeat element vs. `$`
   for the document root. Call out why that distinction exists in one
   sentence.

## 2:45–4:00 — It actually runs (75s)

Switch to the browser demo (`demo/index.html`):

- Point out it's the same annotation JSON and taxpayer JSON from
  `/examples`, live-editable, resolved entirely client-side (no server) by
  `demo/app.js` — a plain-JS port of `src/resolver.ts`.
- Hover a couple of boxes to show the tooltip (id / form line / path).
- Make one live edit — e.g. change a W-2's `box1Wages` value or flip
  `filingStatus` — and show Line 1a's total and the MFJ checkbox react
  instantly. This is the "prove the spec is actually usable" moment.

## 4:00–4:40 — What's deliberately out of scope (40s)

Open `SPEC.md` §11 briefly:

- No arithmetic/formula bindings inside the annotation itself (compute
  upstream, keep annotation declarative/auditable).
- No pagination/continuation-page layout logic.
- No localization.
- One sentence on why: keeps the format small enough that any language can
  implement the full grammar in under an hour.

## 4:40–5:00 — Close (20s)

- One sentence on what's next (§12): a visual authoring tool that emits
  this JSON, since the format's designed to be machine-generated, not just
  hand-written; plus per-field audit metadata since forms change yearly.
- "Spec's in SPEC.md, reference resolver in src/, live demo in demo/ —
  thanks for watching."

## Recording notes

- Loom or QuickTime screen recording both work fine; no need for a talking
  head, screen + voiceover is enough.
- Rehearse the browser demo edit once before recording — pick a change
  that's visually obvious (e.g. doubling a wage number) so the reactivity
  reads clearly on camera.
- If running over time, cut from the "out of scope" section first — the
  data-binding walkthrough and the live demo are the two sections that
  actually prove the spec works.
