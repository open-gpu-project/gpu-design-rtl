# Iteration 4.2 — a connection's geometry belongs to the canvas

2026-09-22. Complete. One follow-up to
[iteration 4.1](./iter-4-1-panel-and-endpoints.md). No file-format change, no router change,
nothing new on screen.

Read [iter-2-docking-and-properties.md](./iter-2-docking-and-properties.md) §3 for the property
grammar and [iter-4-connections.md](./iter-4-connections.md) §2 for the connection model. §3.1
below changes what `PropMode`'s `fixed` means, so it supersedes iter-2 §3's one-line summary of
the three modes.

---

## 1. Scope

**Changed.**

- `source`, `target` and `points` on a connection are `mode: 'fixed'` rather than `'edit'`
  ([conn.props.ts](../src/lib/scene/shapes/conn.props.ts)). Still saved, still restored, still
  documented in the footer — no longer typeable. `routing` stays editable; §3.2 is why.
- The `points` writer no longer forces `routing: 'manual'`. The coupling is removed rather
  than re-ordered, which is what §3.4 is about.
- `hydrateShape` gates on a property having a writer rather than on its being editable
  ([project.ts](../src/lib/props/project.ts)). §3.1 is why, and without it the three would
  have stopped surviving a save.
- `PropertiesView` answers `onClassName` from a plain, non-reactive copy of the schema that is
  current before the document is pushed. §4 — the read-only marking had been one selection
  behind whenever the selected kind changed, and the obvious fix throws.
- Documentation only: `PropMode` and `PropDef.write` in
  [spec.ts](../src/lib/props/spec.ts), and `applyDocument`'s read-only paragraph, which pointed
  at the wrong step number.

**Deliberately not changed.** `SceneDoc.version` is still `2`. A record was always an unordered
bag, so the one key order that did move — `routing` now sorts above `points`, `source` and
`target`, since it is the only one of the four still in the editable group — is a change to the
panel and to the file's _text_, not to its meaning. A block is untouched in every respect:
`rect` has no `fixed` property with a writer, and `verify/production.mjs`'s row-order assertion
needed no edit.

**Verification surface.** `verify/connections.mjs` 77 → 91, in a new group P plus one
whole-suite check that nothing threw on the page. Suite total 247 → 261 across six suites, plus
`verify/production.mjs` at 15. No new dependencies.

---

## 2. Decisions that came from the user

| Decision                                                                           | Note                                                                                                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Make `points`, `routing`, `source` and `target` read-only — they belong to the UI  | Taken as stated, and the first pass did all four.                                                                                           |
| …then put `routing` back, once it was clear that made a pinned route unrecoverable | The right call, and it is a better line than the one it replaces: three of the four are geometry, and `routing` is a choice about geometry. |

The first pass is worth recording rather than quietly overwriting. Freezing all four was a
defensible reading of "the user should not edit these outside the provided UI" — right up to
the point where it turned out the provided UI can only move `routing` one way. The rule that
came out of it is sharper than the rule that went in.

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

A read-only property that is nonetheless real, saved state is the first case where the first
and third answers differ. `fixed` now means "another part of the app is in charge of this", not
"this does not really change" — which is also why `kind` and `points` can share a mode while
having nothing else in common.

Leaving `hydrateShape` on `mode === 'edit'` is not a subtle regression. Every connection in
every saved file comes back as `connOps.blank`: unbound, with a zero-length route at the origin,
which is exactly what `normalize` exists to discard. Confirmed by reverting the one line and
re-running — two assertions fail, the general round trip and the one written for this (§7).

The alternative was a fourth mode. Rejected: the modes are already a small enumeration whose
value is that a reader can hold all of it at once, and the thing that actually varies here is
not a fourth kind of property but a second question about the same one. Gating on
`write !== undefined` says that directly — a property that can be written from a record is one
with a writer — and it needs no new vocabulary.

### 3.2 Three of them are one value; `routing` is a choice about that value

`source`, `target` and `points` are not three independent facts about a connection. The first
point of `points` sits on the anchor `source` names and the last on `target`'s. Change one in a
tree editor and the other two describe a different connection — and every writer would have had
to defend itself against the other two to stop that. The canvas gestures have the opposite
property: `rebind` changes a binding and lets `rerouteAll` supply the geometry (iter-4.1 §3.4),
and a segment drag moves the line and pins it in the same write. They cannot produce an
inconsistent triple.

`routing` is not in that set, and the distinction is not a concession — it is the line itself.
It does not say where the connection runs; it says **who is responsible for saying where the
connection runs**. It has two values, they are both always meaningful, and nothing about the
other three constrains it.

What makes it have to stay editable is that the canvas can only move it one way. A segment drag
sets `manual`. Nothing on the canvas sets `auto`, because there is no gesture whose natural
meaning is "stop keeping the thing I just drew". With `routing` read-only, a route pinned by one
stray drag was pinned for the life of the connection, and the only recovery was to delete it and
draw it again — losing its label, its description and its name. The panel is not a fallback for
that; it is where it belongs.

So the useful question was never "which of these is dangerous to hand-edit". It is "who owns
the route" — all three, together — and separately, "who gets to decide that".

### 3.3 The writers stay, and they are still a trust boundary

All three read-only properties keep their `write`, their type-narrowing helpers and their
validation — `asEndpoint`, `asPointList`, `isRectilinear`, `checkEndpoint`. They are simply
unreachable from the panel now.

That is not dead code, and it is the opposite of a weaker guard. The input they see is a file:
hand-written, hand-merged, or produced by a version of this app that no longer exists. A record
whose `source` names a block that is not in the document is a real thing that happens, and
`checkEndpoint` refusing it means the connection loads unbound and gets dropped, rather than
loading bound to nothing and cascading later from somewhere with no context. `hydrateShape`
already ignores a failed write, so a refusal degrades exactly the way an import should.

### 3.4 The `points` / `routing` coupling is removed, not re-ordered

The `points` writer used to end with `routing: 'manual'`. That existed for one reason: the panel
could edit `points`, and a hand-typed route that the router then overwrote on the next block
move would have been infuriating. It is also what caused iter-4.1 §4.1 — the writer ran on the
load path too, so whichever of the pair `hydrateShape` applied second decided what a saved file
meant, and for one iteration every `auto` connection came back pinned.

iteration 4.1 fixed that by ordering the pair. This iteration removes the pair. `points` is no
longer editable, so the only remaining caller of its writer is the loader, and the loader has
the record's own `routing` sitting right there — the writer second-guessing it is exactly the
bug. Pinning a route is now the job of the gesture that draws one, `connOps.resize`, which sets
`manual` in the same write that moves the segment.

This matters more than it looks, because putting `routing` back in the editable group flipped
the two keys' order: `routing` is now applied _first_. Under the old forcing that is iter-4.1
§4.1 again, verbatim. Decoupling means the order stopped being load-bearing at all, which is a
better place to be than having got the order right.

One behaviour changes as a result. A hand-written file that lists `points` but omits `routing`
used to load as `manual`, keeping those points; it now loads as `auto` and re-routes. That is
the right reading — not saying `manual` should not silently mean it — and no file this app
writes is affected, since `serializeShape` always emits both.

---

## 4. Two defects, the second one behind the first

### 4.1 The read-only marking was one selection behind

Found by the first assertion written for this iteration, which claimed `routing` was not greyed
and failed. `routing` was `mode: 'edit'` by then, and `applyDocument` agreed, and the panel
committed the edit — but the row was still painted grey.

`PropertiesView`'s effect was doing this:

```ts
push(docFor(s), switched); // renders the tree, synchronously
shownSpec = spec; // ...and only now does the panel know which schema that was
```

`onClassName` is called for every node while the tree renders, and svelte-jsoneditor has no
reason to call it again once the document has settled. So the classes were computed from the
_previous_ selection's schema, and `defFor` returning `undefined` for a key that schema has
never heard of falls to the read-only branch.

It is visible in both directions, and one of them is worse:

| Selection                          | Was marked                              |
| ---------------------------------- | --------------------------------------- |
| first connection after a block     | `routing` grey, wrongly                 |
| **first block after a connection** | **`position` and `size` grey, wrongly** |
| the same kind again                | correct                                 |

The second row is the dangerous one: two editable properties reading as uneditable, on the kind
the user spends most of their time in. It could not happen while `rect` was the only kind — the
schema never changed, so being one behind was indistinguishable from being right — and it had
been latent since iteration 4 shipped the second kind.

The fix is `classSpec`, a plain `let` holding the same schema, assigned immediately before the
push and read by `onClassName`. `shownSpec` stays where it is and goes on serving the markup.
Two variables for one value is a smell, so §4.2 is the reason it is the right shape.

### 4.2 Assigning `shownSpec` before the push makes the effect self-invalidating

The obvious fix is to move `shownSpec = spec` above `push`. It type-checks, it fixes the
marking, and it throws

```
TypeError: Cannot read properties of null (reading 'schedule')
    at schedule_effect
    at schedule_possible_effect_self_invalidation
```

out of Svelte's flush, on every selection change, in a component that still looks like it
works.

`validator` is `$derived` from `shownSpec`, and `editor.set` renders synchronously and reads
it. So the effect writes a signal and then, within the same run, reads it back through a
derived — precisely the case Svelte's self-invalidation path exists to detect, and it fires
from inside a flush with no active effect left to reschedule.

This is the hazard the file's existing plain `let`s (`shown`, `pushed`) were introduced for in
iteration 3.2, and the comment on the effect already says so. It is easy to walk into anyway,
because the failure looks nothing like the change: a reordering of three assignments produces a
null dereference inside the framework.

What made it cost a round trip is that **no dev suite failed.** `suite.report(errors)` prints
page errors underneath the passing assertions; it does not fail on them. Only
`verify/production.mjs` asserts `errors.length === 0`, and that suite is deliberately not part
of `npm run verify` — so the suite was 260 green with a `TypeError` on every selection change.
`connections.mjs` now ends with the same assertion.

One thing is not fixed. `validator` is still derived from a `shownSpec` assigned after the
push, so for one synchronous render a kind switch validates the incoming document against the
outgoing schema, which is an error per key. It re-validates as soon as `shownSpec` lands, and a
probe measured zero error nodes once settled, so at worst it is a flash. §5 carries it: the
principled fix is §4.1's, and it is a larger change because the editor wants a validator whose
identity is stable.

---

## 5. Flagged for future work

- **A refusal quotes the property's whole `doc`.** `applyDocument` composes
  `` `${how}. ${d.doc}` ``, which for `points` is a paragraph, of which the sentence the user
  needs is the last one. Fine while read-only keys were `kind` and `zIndex` and the whole doc
  was one line. Worth splitting into a short `insteadDo` the refusal uses on its own.
- **`fixed` now has two populations** — `kind`, which has no writer because the loader has
  already acted on it, and the geometry, which has one. A third kind of `fixed` property would
  be worth a hard look before it is added.
- **Nothing on the canvas hands a pinned route back to the router.** The panel does, and that
  is enough, but a **Re-route** command over the selection would be the discoverable version.
  `replaceShape(c, { ...c, routing: 'auto' })` already does the work.
- **The validator is one push behind on a kind switch.** §4.2's last paragraph. The fix is to
  hand the editor a stable function that dispatches through a plain `let`, the way
  `onClassName` now does, rather than a `$derived` it re-reads mid-render.
- **Only two suites assert that nothing threw on the page**, and one of them does not run under
  `npm run verify`. The other four print page errors and pass. Worth making `report` fail by
  default, with the two known upstream errors filtered explicitly where they occur.

---

## 6. Conventions and gotchas

- **What a synchronous render reads must be current before the render — and must not be
  `$state`.** §4. Writing a signal and reading it back within one effect run is a
  self-invalidating effect; a plain `let` is how you give a third-party component a value the
  reactivity graph does not know about. This file now has three of them.
- **A green `npm run verify` does not mean the page did not throw.** §4.2. Four of the six
  suites print page errors and pass.
- **A read-only property still needs its `write`.** It is what the loader restores it with. Only
  `computed` properties, which are absent from the file, legitimately have none.
- **Do not let a writer set a sibling key.** §3.4. It makes the declaration order load-bearing
  on the load path, where the record already carries both answers and the writer's guess is
  worth less than the file's. If a gesture needs two keys moved together, move them in the
  gesture.
- **Changing a property's mode can reorder the document** — rank is `kind` → editable →
  everything else — which moves it in the panel, in the schema and in the saved file. Check
  `verify/production.mjs`'s row-order assertion.
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

`npm run check` clean — 477 files, 0 errors, 0 warnings. `npm run verify` 261 assertions across
six suites, all passing: grid 61, input 9, properties 38, connections 91, docking 18, trace 44.
`npm run build` then `verify/production.mjs` against the preview server: 15 passing.
`npx prettier --check src verify README.md history` clean.

Group P asserts both halves of the read-only claim — the signpost and the gate — because a
signpost with nothing behind it is worse than neither.

| Assertion                                                         | The regression it catches                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| the route and both endpoints are marked read-only                 | the greying being dropped, leaving an editable-looking row that refuses     |
| and the four a person decides are not                             | the rank rule over-reaching and freezing `routing` with the geometry        |
| nothing threw on the page at any point                            | §4.2, and anything else that throws without failing an assertion            |
| going the other way carries nothing over                          | §4.1, in the direction that mismarks a block                                |
| the footer says so beside the type                                | `describeProp` losing the `· read-only` suffix                              |
| an editable key still commits with three read-only ones beside it | the read-only pass rejecting an untouched key, i.e. blocking every edit     |
| a route can be pinned to a shape the router would not have chosen | the precondition for the next one — a vacuous pass if pinning stops working |
| typing “auto” in the panel hands it back to the router            | the escape hatch, which is the only way back from a stray segment drag      |
| as one history entry, readably labelled                           | the commit landing unlabelled or not at all                                 |
| `applyDocument` refuses all three                                 | the mode being changed in the panel but not in the gate behind it           |
| and names the key and says where it is set instead                | a refusal the user cannot act on                                            |
| and passes an edit that touches only an editable key              | the same, over-corrected                                                    |
| a property the user cannot type is still one the loader puts back | §3.1 — `hydrateShape` going back to `mode === 'edit'`                       |
| an auto route comes back auto (group S, from iteration 4.1)       | §3.4 — the `points` writer reacquiring an opinion about `routing`           |

The last two are the ones to keep. The first of them is the only assertion that distinguishes
"read-only" from "not loaded", and the failure it guards against is silent: the file is written
correctly and read back empty.
