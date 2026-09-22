# Iteration 4.2 — a connection's geometry belongs to the canvas

2026-09-22. Complete. One follow-up to
[iteration 4.1](./iter-4-1-panel-and-endpoints.md). No file-format change, no router change,
nothing new on screen.

Read [iter-2-docking-and-properties.md](./iter-2-docking-and-properties.md) §3 for the property
grammar and [iter-4-connections.md](./iter-4-connections.md) §2 for the connection model. §3.1
below changes what `PropMode`'s `fixed` means, so it supersedes iter-2 §3's one-line summary of
the three modes, and §4 withdraws iter-4 §2's escape hatch for a pinned route.

---

## 1. Scope

**Changed.**

- `source`, `target`, `routing` and `points` on a connection are `mode: 'fixed'` rather than
  `'edit'` ([conn.props.ts](../src/lib/scene/shapes/conn.props.ts)). Still saved, still
  restored, still documented in the footer — no longer typeable.
- `hydrateShape` gates on a property having a writer rather than on its being editable
  ([project.ts](../src/lib/props/project.ts)). §3.1 is why, and without it the four would have
  stopped surviving a save.
- Documentation only: `PropMode` and `PropDef.write` in
  [spec.ts](../src/lib/props/spec.ts), and `applyDocument`'s read-only paragraph, which pointed
  at the wrong step number.

**Deliberately not changed.** No key moved. All four sort after `name` alphabetically whichever
group they are in, so the canonical order is byte-identical and `verify/production.mjs`'s
row-order assertion needed no edit. `SceneDoc.version` is still `2`. A block has no `fixed`
property with a writer, so nothing about a block changed at all. The store-level path is
untouched: `replaceShape(c, { ...c, routing: 'auto' }, 're-route')` still works and is still
asserted — what went away is the panel's ability to reach it.

**Verification surface.** `verify/connections.mjs` 77 → 87, in a new group P. Suite total
247 → 257 across six suites, plus `verify/production.mjs` at 15. No new dependencies.

---

## 2. The decision that came from the user

> Can you make `points`, `routing`, `source` and `target` read-only in the JSON property viewer
> for lines? It makes little sense for the user to edit these outside the provided UI.

Taken as stated, for all four. §4 records the one thing it costs and what would buy it back.

---

## 3. Load-bearing decisions

### 3.1 `fixed` is a claim about authority, not about storage

`mode === 'edit'` had been carrying three different questions at once, and they had the same
answer for every property that existed, so nothing forced them apart:

| Question                               | Asked by         | Used to be     | Is now         |
| -------------------------------------- | ---------------- | -------------- | -------------- |
| May the **user** set this key?         | `applyDocument`  | `edit`         | `edit`         |
| Does the **file** carry this key?      | `serializeShape` | not `computed` | not `computed` |
| May the **loader** set it from a file? | `hydrateShape`   | `edit`         | has a `write`  |

A read-only property that is nonetheless real, saved state is the first case where the first and
third answers differ. `fixed` now means "another part of the app is in charge of this", not
"this does not really change" — which is also why `kind` and `points` can share a mode while
having nothing else in common.

Leaving `hydrateShape` on `mode === 'edit'` is not a subtle regression. Every connection in
every saved file comes back as `connOps.blank`: unbound, with a zero-length route at the origin,
which is exactly what `normalize` exists to discard. Confirmed by reverting the one line and
re-running — two assertions fail, the general round-trip and the one written for this (§7).

The alternative was a fourth mode. Rejected: the modes are already a small enumeration whose
value is that a reader can hold all of it at once, and the thing that actually varies here is
not a fourth kind of property but a second question about the same one. Gating on `write !==
undefined` says that directly — a property that can be written from a record is one with a
writer — and it needs no new vocabulary.

### 3.2 The four move together because they are one value

`source`, `target`, `routing` and `points` are not four independent facts about a connection.
The first point of `points` must sit on the anchor `source` names; the last on `target`'s; and
`routing` says which of the two — the router or the user — is responsible for keeping that true.
Change one in a tree editor and the other three describe a different connection.

The canvas gestures keep them coupled by construction: `rebind` changes a binding and lets
`rerouteAll` supply the geometry (iter-4.1 §3.4), and a segment drag changes the geometry and
sets `routing` in the same write. Nothing equivalent was possible through the panel, and the
writers showed it — the `points` writer forced `routing: 'manual'` behind the user's back
specifically because there was no other way to keep the pair honest, and that is the writer
whose ordering against `routing` caused iter-4.1 §4.1.

So the useful line is not "which of these is dangerous to edit" but "who owns the route". All
four, or none.

### 3.3 The writers stay, and they are still a trust boundary

Every one of the four keeps its `write`, its type-narrowing helpers and its validation —
`asEndpoint`, `asPointList`, `isRectilinear`, `checkEndpoint`. They are simply unreachable from
the panel now.

That is not dead code, and it is the opposite of a weaker guard. The input they see is a file:
hand-written, hand-merged, or produced by a version of this app that no longer exists. A record
whose `source` names a block that is not in the document is a real thing that happens, and
`checkEndpoint` refusing it means the connection loads unbound and gets dropped, rather than
loading bound to nothing and cascading later from somewhere with no context. `hydrateShape`
already ignores a failed write, so a refusal degrades exactly the way an import should.

---

## 4. What this costs: `routing` is a one-way door now

A connection starts `auto`. Dragging any segment pins it to `manual`. The panel's `routing`
property was the only way back, and it is gone.

This is a real loss and it is stated plainly in the property's own `doc` string, which is
user-facing text: _"a connection starts out 'auto' and dragging any of its segments switches it
to 'manual' for good. To get an automatic route back, delete the connection and draw it
again."_ Delete-and-redraw genuinely works, and so does undo; neither is a good answer if the
connection has a label and a description on it.

Not fixed here because the fix is a new command, not a property: something like **Re-route**
on the selected connections, which is a toolbar button or a shortcut plus a hint string plus
its own history label — a feature, and not one that was asked for. §5 carries it.

The narrower alternative — make `routing` read-only _except_ for `manual` → `auto` — was
rejected outright. A property that accepts one of its two values is worse than one that accepts
neither: the greying would be a lie, `applyDocument`'s read-only pass would need a per-value
exception, and the user would have discovered the rule by being refused.

---

## 5. Flagged for future work

- **There is no way back to an automatic route.** §4. The shape of the fix is a `reroute`
  command over the selection, committing under its own label; `SceneStore.replaceShape` with
  `routing: 'auto'` already does the work and is already asserted, so it is the command surface
  that is missing, not the behaviour.
- **A refusal quotes the property's whole `doc`.** `applyDocument` composes
  `` `${how}. ${d.doc}` ``, which for `routing` is a paragraph, of which the sentence the user
  needs is the last one. Fine while read-only keys were `kind` and `zIndex` and the whole doc
  was one line. Worth splitting into a short `insteadDo` the refusal uses on its own.
- **`fixed` now has two populations** — `kind`, which has no writer because the loader has
  already acted on it, and the geometry, which has one. A third kind of `fixed` property would
  be worth a hard look before it is added.

---

## 6. Conventions and gotchas

- **A read-only property still needs its `write`.** It is what the loader restores it with. Only
  `computed` properties, which are absent from the file, legitimately have none.
- **Making a property read-only can reorder the document.** Rank is `kind` → editable →
  everything else, so moving a key between the last two groups moves it in the panel, in the
  schema and in the saved file. It happened not to here, because all four sort after `name`
  either way. Check `verify/production.mjs`'s row-order assertion when it is not a coincidence.
- **After `editValue`, the caret is in the JSON tree, and the canvas shortcuts stop working.**
  `ToolHost.#globalKey` ignores keys aimed at an editable element, so a following `drawBlock`
  presses `Digit2` into the tree and then marquee-drags across the canvas. Click the canvas
  first. This cost a confusing failure three groups downstream of the edit that caused it.
- **A refused edit stays in the editor.** `handleChange` deliberately leaves the user's text on
  screen and does not re-push, so the next edit is validated against a document that still
  carries the refused value and is refused too. Re-select to clear it. Assert a successful edit
  before a refusal, not after.
- **Importing a module by URL in `page.evaluate` is safe for pure ones.** iter-4.1 §4.4's trap
  is about module-level _state_ — the registry. `props/project.ts` and `conn.props.ts` hold
  none, and the read-only pass rejects before any writer runs, so `opsFor` is never reached.

---

## 7. How iteration 4.2 was verified

`npm run check` clean — 477 files, 0 errors, 0 warnings. `npm run verify` 257 assertions across
six suites, all passing: grid 61, input 9, properties 38, connections 87, docking 18, trace 44.
`npm run build` then `verify/production.mjs` against the preview server: 15 passing.
`npx prettier --check src verify README.md history` clean.

Group P in `verify/connections.mjs` asserts both halves — the signpost and the gate — because a
signpost with nothing behind it is worse than neither.

| Assertion                                                         | The regression it catches                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| the route and both endpoints are marked read-only                 | the greying being dropped, leaving an editable-looking row that refuses |
| and the three things a person names are not                       | the rank rule over-reaching and freezing the whole kind                 |
| the footer says so beside the type                                | `describeProp` losing the `· read-only` suffix                          |
| an editable key still commits with four read-only ones beside it  | the read-only pass rejecting an untouched key, i.e. blocking every edit |
| typing a routing mode into the panel changes nothing              | the whole point                                                         |
| and the refusal names the key and points at where it is set       | a refusal the user cannot act on                                        |
| `applyDocument` refuses every one of the four                     | the mode being changed in the panel but not in the gate behind it       |
| and passes an edit that touches only an editable key              | the same, over-corrected                                                |
| a property the user cannot type is still one the loader puts back | §3.1 — `hydrateShape` going back to `mode === 'edit'`                   |

The last one is the one to keep. It is the only assertion that distinguishes "read-only" from
"not loaded", and the failure it guards against is silent: the file is written correctly and
read back empty.
