<script lang="ts">
  import {
    JSONEditor,
    Mode,
    isJSONContent,
    isKeySelection,
    isValueSelection,
    type Content,
    type JSONEditorSelection,
  } from 'svelte-jsoneditor';
  import { simplifyContextMenu } from '../lib/props/context-menu';
  import { applyDocument, projectShape } from '../lib/props/project';
  import { describeProp } from '../lib/props/schema';
  import { defFor, type PropContext, type PropDef, type PropSchema } from '../lib/props/spec';
  import { makeValidator } from '../lib/props/validate';
  import { opsFor } from '../lib/scene/registry';
  import type { Shape } from '../lib/scene/shape';
  import { useSession } from '../lib/session.svelte';
  import { formatLeaf, isRecord, type TraceSignal, type TraceValue } from '../lib/trace/model';

  const { scene, host, renderer, trace, timelineHost } = useSession();

  /** Editor floor: roughly four tree rows. Paired with the `min-height` override in the
   *  stylesheet below -- without that the editor cannot honour a floor this small. */
  const MIN_EDITOR = 80;
  /** Footer floor: the heading line plus one line of prose. */
  const MIN_DOCS = 44;
  const DEFAULT_DOCS = 88;
  const DOCS_KEY = 'archsim.traceviewer.props.docs.v1';

  let editor = $state<ReturnType<typeof JSONEditor> | undefined>(undefined);
  let footerPath = $state.raw<readonly string[] | null>(null);
  let problem = $state('');

  let editorHeight = $state(0);
  let docsMeasured = $state(0);
  let docsHeight = $state(loadDocsHeight());
  let resizing = $state(false);

  /**
   * How tall the docs may grow right now.
   *
   * Measured from the two flexible boxes rather than from the panel, so the banner, the alert
   * strip and the grip are accounted for without enumerating them: whatever those two share
   * today is what there is to redistribute, minus the editor's floor. Their sum is invariant
   * under a drag -- one grows exactly as much as the other shrinks -- so this is safe to read
   * live instead of snapshotting it, and it re-clamps for free when the pane itself resizes.
   */
  const docsMax = $derived(Math.max(MIN_DOCS, editorHeight + docsMeasured - MIN_EDITOR));

  /*
    Keeps the requested height honest when the *pane* changes size. The stylesheet's max-height
    holds the footer back immediately, but `docsHeight` would stay too large behind it and the
    next drag or keypress would start from a number that is not on screen. Converges in one
    pass: the two boxes always sum to the same total, so writing the ceiling does not move it.
  */
  $effect(() => {
    if (docsHeight > docsMax) docsHeight = docsMax;
  });

  function loadDocsHeight(): number {
    try {
      const n = Number(localStorage.getItem(DOCS_KEY));
      // Only a sanity floor/ceiling -- the pane's size is not known yet. `docsMax` and the
      // stylesheet's `max-height` are what clamp this against the space actually available.
      return Number.isFinite(n) && n >= MIN_DOCS ? Math.min(n, 600) : DEFAULT_DOCS;
    } catch {
      return DEFAULT_DOCS; // private mode, or storage disabled
    }
  }

  function saveDocsHeight(): void {
    try {
      localStorage.setItem(DOCS_KEY, String(Math.round(docsHeight)));
    } catch {
      // Losing a panel size is not worth breaking the app over.
    }
  }

  const clampDocs = (n: number): number => Math.max(MIN_DOCS, Math.min(n, docsMax));

  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    const grip = event.currentTarget as HTMLElement;
    const startY = event.clientY;
    const startHeight = docsHeight;

    const move = (e: PointerEvent): void => {
      docsHeight = clampDocs(startHeight - (e.clientY - startY));
    };
    const stop = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', stop);
      grip.removeEventListener('pointercancel', stop);
      resizing = false;
      saveDocsHeight();
    };

    grip.setPointerCapture(event.pointerId);
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);
    resizing = true;
    event.preventDefault(); // no text-selection drag-out
  }

  function resizeByKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 32 : 8;
    const next =
      event.key === 'ArrowUp'
        ? docsHeight + step
        : event.key === 'ArrowDown'
          ? docsHeight - step
          : event.key === 'Home'
            ? docsMax
            : event.key === 'End'
              ? MIN_DOCS
              : null;
    if (next === null) return;
    event.preventDefault();
    docsHeight = clampDocs(next);
    saveDocsHeight();
  }

  /*
    Deliberately plain `let`, not runes. These are bookkeeping for the push/commit handshake and
    must never schedule anything -- making them reactive would create exactly the feedback loop
    they exist to prevent.
  */
  let pushed = '';
  /**
   * An identity key for whatever is on screen: `shape:<name>` or `event:<signal>@<tick>`.
   *
   * A key rather than a shape name because the panel now shows two unrelated kinds of thing,
   * and `set` versus `update` turns on "is this a different object", which has to mean
   * different *across* kinds too.
   */
  let shown: string | null = null;

  /*
    What the editor is holding, which is not the same thing as what is selected.

    The push below is deferred for the length of a canvas gesture, so between the pointerdown
    that selects a block and the pointerup that ends the move, the selection has changed and the
    document has not. Everything wrapped around the editor -- the validator, `readOnly`, the row
    classes, the footer, the veil, the banner -- has to describe the document on screen rather
    than the one that is coming. Deriving them from the selection instead meant that pressing on
    an unselected block pulled the veil off the empty document and lit it up with one "must have
    required property" error per key, for as long as the button was held.

    Two plain sources rather than one record, on purpose: assigning a `$state` its current value
    is a no-op, so `shownSpec` keeps its identity across a selection change within one kind and
    the validator below is not rebuilt.
  */
  let shownSpec = $state.raw<PropSchema | null>(null);
  let shownCount = $state(0);

  /*
    The trace signal whose event is on screen, and at which tick. Same contract as `shownSpec`:
    written only where a document is actually pushed, never derived from the live selection.

    A trace event is read-only, so it needs none of the commit machinery -- `shownSpec` stays
    null for one, which is already what drives `readOnly`, the validator and `onClassName`.
  */
  let shownSignal = $state.raw<TraceSignal | null>(null);
  let shownTick = $state(0);

  /*
    `others` is a callback, not a snapshot, so this keeps a stable identity for as long as the
    displayed *kind* is unchanged. Handing the editor a new `validator` on every scene change
    would make it re-validate the document continuously.
  */
  const validator = $derived(
    shownSpec === null
      ? undefined
      : makeValidator(shownSpec, function* () {
          const self = scene.soleSelected();
          for (const s of scene.shapes) if (s !== self) yield s.name;
        }),
  );

  function contextFor(s: Shape): PropContext {
    return { shapes: scene.shapes, index: scene.shapes.indexOf(s) };
  }

  function docFor(s: Shape): Record<string, unknown> {
    return { ...projectShape(opsFor(s).props, s, contextFor(s)) };
  }

  /**
   * One traced record as a flat document.
   *
   * Key order comes from the signal's wire order, for the same reason the property editor takes
   * it from the `props` declaration: a stable order is what lets the push comparison work on
   * serialized text.
   *
   * Enum fields are shown by **name**, not by wire number. That is not a display flourish --
   * it is what the producer's own `reinterpret_to_json` does with the `x-beve-enum` sidecar, so
   * a number here would disagree with every other rendering of the same trace.
   */
  function recordDoc(signal: TraceSignal, v: TraceValue): Record<string, unknown> {
    if (!isRecord(v)) return { value: v };
    const out: Record<string, unknown> = {};
    for (const f of signal.fields) {
      if (!(f.name in v)) continue;
      out[f.name] = f.enumNames === undefined ? v[f.name] : formatLeaf(v[f.name]!, f);
    }
    // Anything the schema did not mention still gets shown, rather than silently dropped.
    for (const k of Object.keys(v)) if (!(k in out)) out[k] = v[k];
    return out;
  }

  /**
   * Hand a document to the editor, unless it already holds exactly that.
   *
   * `update` keeps the same editor instance, so expansion state and the caret survive, and --
   * critically -- it does not fire `onChange`. `set` mints a new instance and resets both, so
   * it is used only when the panel switches to a different object.
   *
   * The `pushed` comparison is the entire loop guard. Pushing is idempotent, so the effect that
   * fires as a consequence of our own commit re-derives the identical text, compares equal, and
   * does nothing. No applying flag, no epoch counter.
   */
  function push(doc: unknown, reset: boolean): void {
    const text = JSON.stringify(doc);
    if (!reset && text === pushed) return;
    pushed = text;
    if (reset) editor?.set({ json: doc });
    else editor?.update({ json: doc });
  }

  /**
   * Drop the editor's own caret, ahead of a document whose keys are about to change.
   *
   * `set` re-creates the tree, and the new one inherits the caret: on mount it expands that
   * path against the incoming document and throws `Cannot convert path` when the path is not
   * there. Deselecting a block while a tuple element was selected is exactly that case, and it
   * threw all the way up as an uncaught error.
   *
   * Only where the keys really do change, though. Holding the caret on `size` while clicking
   * from one block to the next is worth keeping, and there the path still resolves.
   *
   * The footer is cleared by hand because the editor does not report a selection it was
   * handed -- and it has to be, or it would go on documenting a key that is no longer shown.
   */
  function dropCaret(): void {
    editor?.select(undefined);
    footerPath = null;
  }

  $effect(() => {
    void scene.shapes;
    void scene.selection;
    const event = trace.selectedEvent;
    // The wake-up for the bails below. Without it, click-to-select would never reach the panel:
    // the press starts a move-drag, this effect defers, and a click that never moved commits
    // nothing -- so no scene signal ever arrives to try again.
    void host.gestureVersion;
    void timelineHost.gestureVersion;

    // Not tracked reads: `isGesturing` is plain state, which is what makes these filters rather
    // than dependencies. The timeline one matters as much as the canvas one -- dragging the
    // time cursor changes the selected event on every pointermove, and re-`set`ting the tree
    // that often is both visibly slow and a caret-thrash.
    if (host.isGesturing()) return;
    if (timelineHost.isGesturing()) return;

    // Selection is global and the two are mutually exclusive, but the scene is checked first
    // regardless: if both were ever populated, the block is the thing the user last touched.
    if (scene.selection.size === 0 && event !== null) {
      const signal = trace.signalOf(event.signal);
      if (signal !== undefined) {
        const key = `event:${event.signal}@${event.tick}`;
        const doc =
          event.values.length === 1
            ? recordDoc(signal, event.values[0]!)
            : event.values.map((v) => recordDoc(signal, v));
        // Always a reset: the keys differ from whatever was there, and `set` inheriting a caret
        // that no longer resolves is iter-2 defect 8.
        if (key !== shown) dropCaret();
        push(doc, key !== shown);
        shown = key;
        shownSpec = null;
        shownCount = event.values.length;
        shownSignal = signal;
        shownTick = event.tick;
        problem = '';
        return;
      }
    }

    const s = scene.soleSelected();
    if (s === null) {
      const doc = scene.selection.size === 0 ? {} : scene.selectedShapes().map(docFor);
      dropCaret();
      push(doc, true);
      shown = null;
      shownSpec = null;
      shownCount = scene.selection.size;
      shownSignal = null;
      problem = '';
      return;
    }
    // Switching to a different object clears a stale rejection: the message is about an edit
    // to the thing you were just looking at, not this one.
    const key = `shape:${s.name}`;
    const switched = key !== shown;
    if (switched) problem = '';
    const spec = opsFor(s).props;
    if (spec !== shownSpec) dropCaret();
    push(docFor(s), switched);
    shown = key;
    shownSpec = spec;
    shownCount = 1;
    shownSignal = null;
  });

  function handleChange(content: Content): void {
    if (!isJSONContent(content)) {
      problem = 'Properties must be a JSON object.';
      return;
    }
    const prev = scene.soleSelected();
    if (prev === null) return;
    if (host.isGesturing()) {
      problem = 'Finish the canvas gesture before editing properties.';
      return;
    }

    // Take the editor's own text as the current state either way. A rejected edit is left on
    // screen with an explanation rather than yanked out from under the user -- the schema
    // annotation already marks it red, and reverting mid-thought is hostile.
    pushed = JSON.stringify(content.json);

    const result = applyDocument(opsFor(prev).props, prev, content.json, contextFor(prev));
    if (!result.ok) {
      problem = result.error;
      return;
    }
    problem = '';
    if (result.shape === prev) return; // parsed clean but nothing actually differs

    // Set before committing, so the effect the commit triggers sees the name it expects and
    // refreshes with `update` rather than resetting the tree.
    shown = `shape:${result.shape.name}`;
    scene.replaceShape(prev, result.shape, `edit ${result.changed.join(', ')}`);
    renderer.requestFrame();
  }

  function handleSelect(sel: JSONEditorSelection | undefined): void {
    footerPath = isKeySelection(sel) || isValueSelection(sel) ? sel.path : null;
  }

  const footerDef = $derived<PropDef | null>(
    shownSpec === null ? null : (defFor(shownSpec, footerPath?.[0]) ?? null),
  );

  /**
   * The traced field the caret is on.
   *
   * For a merged flag the document is an array, so the key is one level deeper: `[2, "opcode"]`
   * rather than `["opcode"]`.
   */
  const footerTraceField = $derived.by(() => {
    const sig = shownSignal;
    if (sig === null || footerPath === null) return null;
    const key = shownCount > 1 ? footerPath[1] : footerPath[0];
    if (key === undefined) return null;
    return sig.fields.find((f) => f.name === key) ?? null;
  });

  /** Which slot of a tuple the caret is in, e.g. "width" for `size` element 1. */
  const footerSlot = $derived.by(() => {
    const d = footerDef;
    const raw = footerPath?.[1];
    if (d === null || raw === undefined || d.type.type !== 'tuple') return null;
    const i = Number(raw);
    return Number.isInteger(i) ? (d.type.labels[i] ?? null) : null;
  });
</script>

<div class="panel" class:resizing>
  {#if shownSignal !== null}
    <div class="banner">
      <span class="sig">{shownSignal.name}</span>
      &nbsp;@ tick {shownTick}
      {#if shownCount > 1}&nbsp;&mdash; {shownCount} events{/if}
      &nbsp;&mdash; read-only
    </div>
  {:else if shownCount > 1}
    <div class="banner">{shownCount} objects selected &mdash; read-only</div>
  {/if}

  <!--
    `jse-theme-dark` is a class contract, not a component prop: the theme stylesheet scopes every
    one of its `--jse-*` overrides under it.
  -->
  <div class="editor jse-theme-dark" bind:clientHeight={editorHeight}>
    <JSONEditor
      bind:this={editor}
      content={{ json: {} }}
      mode={Mode.tree}
      readOnly={shownSpec === null}
      mainMenuBar={false}
      navigationBar={false}
      statusBar={false}
      {validator}
      onChange={handleChange}
      onSelect={handleSelect}
      onRenderContextMenu={simplifyContextMenu}
      onClassName={(path) =>
        shownSpec !== null && path.length > 0 && defFor(shownSpec, path[0])?.mode !== 'edit'
          ? 'archsim-readonly'
          : undefined}
    />

    {#if shownSpec === null && shownCount === 0 && shownSignal === null}
      <div class="veil">Select a block or a trace event to inspect it</div>
    {/if}
  </div>

  <!--
    A refused edit gets its own strip rather than sharing the footer. It has to outlive the
    selection -- committing a value moves the caret to the next row, so anything cleared on
    selection change would vanish before it could be read -- and the documentation below has
    to keep working while it is up.
  -->
  {#if problem !== ''}
    <div class="alert" role="alert">{problem}</div>
  {/if}

  <!--
    Drag to trade tree height for documentation height. Styled and keyed like svgrid's own
    splitters on purpose -- inside a dock workspace this reads as one more pane divider, which
    is exactly what it is.

    A focusable separator is ARIA's window-splitter pattern, and `aria-valuenow` is required
    for it -- but svelte-check's table has `separator` as non-interactive either way, so the
    tabindex and the handlers both have to be waived. svgrid waives the same rule for its own
    splitters, which are not keyboard-operable at all.
  -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="grip"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize documentation"
    aria-valuenow={Math.round(docsHeight)}
    aria-valuemin={MIN_DOCS}
    aria-valuemax={Math.round(docsMax)}
    tabindex="0"
    onpointerdown={startResize}
    onkeydown={resizeByKey}
  ></div>

  <!--
    The footer is the whole reason `PropDef.doc` is a first-class field: the tree view has no
    tooltips, so this is where a property's documentation is allowed to be long.
  -->
  <footer class="footer" bind:clientHeight={docsMeasured} style:height={`${docsHeight}px`}>
    {#if footerDef !== null}
      <p class="head">
        {footerDef.title}{#if footerSlot !== null}<span class="slot">
            &rsaquo; {footerSlot}</span
          >{/if}
        <span class="type">{describeProp(footerDef)}</span>
      </p>
      <p class="body">{footerDef.doc}</p>
    {:else if footerTraceField !== null}
      <p class="head">
        {footerTraceField.name}
        <span class="type">
          {footerTraceField.enumNames === undefined ? 'traced value' : 'enumeration'}
        </span>
      </p>
      <p class="body">{footerTraceField.doc}</p>
    {:else if shownSignal !== null}
      <p class="body dim">{shownSignal.doc}</p>
    {:else}
      <p class="body dim">Select a property to read what it does.</p>
    {/if}
  </footer>
</div>

<style>
  .panel {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    background: var(--color-panel);
  }

  .banner {
    flex: none;
    border-bottom: 1px solid var(--color-panel-border);
    padding: 0.375rem 0.625rem;
    font-size: 0.75rem;
    color: var(--color-ink-dim);
  }

  .editor {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  /* Covers the empty `{}` document rather than unmounting ~50 components on every deselect. */
  .veil {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    text-align: center;
    font-size: 0.8125rem;
    color: var(--color-ink-dim);
    background: var(--color-panel);
  }

  /*
    `.jse-main` defaults to `min-height: 150px`, which is a sensible floor for an editor that
    owns its page and a wrong one for a pane whose height the user is deliberately setting: it
    would overflow `.editor` instead of shrinking with it, and in a short floating window it
    squeezed the documentation down to a few pixels. Let it shrink; the tree scrolls already.
  */
  .editor :global(.jse-main) {
    min-height: 0;
  }

  /*
    Height comes from the grip; `max-height` is the passive half of the same clamp, for the one
    case a drag cannot catch -- the pane itself getting shorter afterwards. 5rem is MIN_EDITOR.
  */
  .footer {
    flex: none;
    max-height: calc(100% - 5rem);
    overflow-y: auto;
    padding: 0.5rem 0.625rem;
  }

  .grip {
    flex: none;
    position: relative;
    height: 4px;
    cursor: row-resize;
    background: var(--color-panel-border);
    touch-action: none;
  }

  /* Hit area wider than the hairline, the way svgrid's splitters do it. */
  .grip::after {
    content: '';
    position: absolute;
    inset: -3px 0;
  }

  .grip:hover,
  .grip:focus-visible {
    background: var(--color-accent);
    outline: none;
  }

  /* Hold the cursor for the whole drag, even where it strays off the 4px strip. */
  .resizing {
    cursor: row-resize;
    user-select: none;
  }

  .head {
    margin: 0 0 0.1875rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-ink);
  }

  .slot {
    color: var(--color-accent);
  }

  .sig {
    color: var(--color-ink);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .type {
    margin-left: 0.5rem;
    font-weight: 400;
    color: var(--color-ink-dim);
  }

  /* No line clamp: the grip is what decides how much prose is on screen, and anything past
     that scrolls rather than being silently truncated. */
  .body {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--color-ink-dim);
  }

  .dim {
    font-style: italic;
  }

  .alert {
    flex: none;
    border-top: 1px solid rgb(248 113 113 / 0.35);
    background: rgb(248 113 113 / 0.1);
    padding: 0.375rem 0.625rem;
    font-size: 0.75rem;
    line-height: 1.35;
    color: #fca5a5;
    max-height: 4rem;
    overflow: hidden;
  }
</style>
