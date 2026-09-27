<script lang="ts">
  /*
    Custom rather than `SvTree`: that one is single-select, its click carries no event to read ⌘
    from, and it keeps its expansion state internally where a dock remount would lose it.

    Read-only. Keys this tree does not use -- Space, the digits, Escape, Delete and every ⌘ chord
    -- are left alone so they reach the diagram, which shares its keyboard with this panel.
  */
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { tick, untrack } from 'svelte';
  import {
    outlineOf,
    outlineRows,
    pathTo,
    type OutlineRoot,
    type OutlineRow,
  } from '../lib/scene/outline';
  import { opsForKind } from '../lib/scene/registry';
  import type { ShapeName } from '../lib/scene/shape';
  import { useSession, type DiagramEntry } from '../lib/session.svelte';
  import { addsToSelection, modifiersOf } from '../lib/tools/pointer';

  const session = useSession();
  const byId = new Map<string, DiagramEntry>(session.diagrams.map((d) => [d.id, d]));

  /*
    The last rows handed out, so `outlineRows` can return them again by reference when nothing
    the markup reads has changed. A plain `let`: it is a cache, and reading it must not make the
    derivation depend on its own output.
  */
  let prevRows: readonly OutlineRow[] | null = null;

  const roots = $derived<OutlineRoot[]>(
    session.diagrams.map((d) => ({ id: d.id, title: d.title, nodes: outlineOf(d.scene.shapes) })),
  );
  const rows = $derived.by(() => {
    const next = outlineRows(roots, session.objectTreeOpen, prevRows);
    prevRows = next;
    return next;
  });

  /** The row that holds the tab stop. Falls back to the first row when it is gone. */
  let focusKey = $state<string | null>(null);
  const tabKey = $derived(
    focusKey !== null && rows.some((r) => r.key === focusKey) ? focusKey : (rows[0]?.key ?? null),
  );

  let scroller: HTMLElement | undefined = $state();

  function isSelected(row: OutlineRow): boolean {
    if (row.name === null) return false;
    return byId.get(row.diagram)?.scene.selection.has(row.name) ?? false;
  }

  function rowEl(key: string): HTMLElement | null {
    return scroller?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null;
  }

  /**
   * Scroll the tree's own box, never an ancestor's. `scrollIntoView` would also scroll the
   * dock's `overflow: hidden` wrappers, which have no scrollbar to scroll them back with.
   */
  function reveal(key: string): void {
    const el = rowEl(key);
    if (scroller === undefined || el === null) return;
    const r = el.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    if (r.top < s.top) scroller.scrollTop += r.top - s.top;
    else if (r.bottom > s.bottom) scroller.scrollTop += r.bottom - s.bottom;
  }

  async function focusRow(key: string): Promise<void> {
    focusKey = key;
    await tick();
    // `preventScroll` for the same reason `reveal` exists.
    rowEl(key)?.focus({ preventScroll: true });
    reveal(key);
  }

  /** Move to a row: it takes focus, and an object row is selected. Any other row only focuses. */
  function moveTo(i: number): void {
    const row = rows[i];
    if (row === undefined) return;
    if (row.name !== null) session.selectObject(row.diagram, row.name, 'only');
    void focusRow(row.key);
  }

  function onRowClick(e: MouseEvent, row: OutlineRow): void {
    const onTwisty = (e.target as Element | null)?.closest('.tree-twisty') != null;
    if (row.name === null || (onTwisty && row.expandable)) {
      session.setObjectOpen(row.key, !row.expanded);
    } else {
      session.selectObject(
        row.diagram,
        row.name,
        addsToSelection(modifiersOf(e)) ? 'toggle' : 'only',
      );
    }
    void focusRow(row.key);
  }

  function onRowKey(e: KeyboardEvent, i: number): void {
    // A chord is the diagram's, not a tree movement.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const row = rows[i]!;
    switch (e.key) {
      case 'ArrowDown':
        moveTo(i + 1);
        break;
      case 'ArrowUp':
        moveTo(i - 1);
        break;
      case 'ArrowRight':
        if (row.expandable && !row.expanded) session.setObjectOpen(row.key, true);
        else if (row.expanded) moveTo(i + 1);
        break;
      case 'ArrowLeft':
        if (row.expanded) {
          session.setObjectOpen(row.key, false);
        } else {
          for (let j = i - 1; j >= 0; j--) {
            if (rows[j]!.level < row.level) {
              moveTo(j);
              break;
            }
          }
        }
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(rows.length - 1);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  /*
    Canvas to tree: when the selection becomes a single object, open its ancestors and bring its
    row into view.

    Tracks the selection and the gesture counter and nothing else. Deferred while a gesture is
    in flight, because the marquee writes the selection on every move. Acts only on a Set it has
    not seen, or on a seen one whose object now has different ancestors, so collapsing a parent
    -- or a pan, which ends a gesture without selecting -- never re-opens what the user just
    closed. The second half is for a drag: moving an already-selected block into a collapsed
    group keeps the same Set, and the row would otherwise vanish into the closed parent.

    What opens is every row on the way down, a folded run of wires included, so a wire selected
    on the canvas shows up in the tree however many others it is folded with.
  */
  interface Seen {
    readonly sel: ReadonlySet<ShapeName>;
    /** The keys `pathTo` gave, or empty for no single object. */
    readonly path: readonly string[];
  }
  const seen = new Map<string, Seen>();
  const samePath = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((k, i) => k === b[i]);
  $effect(() => {
    for (const d of session.diagrams) {
      void d.scene.selection;
      void d.host.gestureVersion;
    }
    untrack(() => {
      for (const d of session.diagrams) void follow(d);
    });
  });

  async function follow(d: DiagramEntry): Promise<void> {
    if (d.host.isGesturing()) return;
    const sel = d.scene.selection;
    const name = sel.size === 1 ? (sel.values().next().value as ShapeName) : null;
    const root = roots.find((r) => r.id === d.id);
    const path = (name === null || root === undefined ? null : pathTo(root, name)) ?? [];
    const last = seen.get(d.id);
    if (last !== undefined && last.sel === sel && samePath(last.path, path)) return;
    seen.set(d.id, { sel, path });
    if (name === null || path.length === 0) return;
    for (const k of path) {
      if (!session.objectTreeOpen.has(k)) session.setObjectOpen(k, true);
    }
    const key = `${d.id}:${name}`;
    focusKey = key;
    await tick();
    reveal(key);
  }
</script>

<div class="tree-pane">
  <div
    class="tree-scroll"
    role="tree"
    aria-label="Objects"
    aria-multiselectable="true"
    bind:this={scroller}
  >
    {#each rows as row, i (row.key)}
      <div
        class="tree-row"
        class:tree-root={row.role === 'diagram'}
        class:tree-selected={isSelected(row)}
        role="treeitem"
        tabindex={row.key === tabKey ? 0 : -1}
        aria-level={row.level}
        aria-expanded={row.expandable ? row.expanded : undefined}
        aria-selected={row.name === null ? undefined : isSelected(row)}
        aria-posinset={row.posinset}
        aria-setsize={row.setsize}
        data-key={row.key}
        data-diagram={row.diagram}
        data-name={row.name ?? undefined}
        style:padding-left="{0.25 + (row.level - 1) * 0.875}rem"
        onmousedown={(e) => e.preventDefault()}
        onclick={(e) => onRowClick(e, row)}
        onkeydown={(e) => onRowKey(e, i)}
      >
        <span class="tree-twisty" class:tree-open={row.expanded}>
          {#if row.expandable}
            <ChevronRight class="h-3.5 w-3.5" />
          {/if}
        </span>
        {#if row.role === 'diagram'}
          <span class="tree-title">{row.label}</span>
        {:else}
          {@const Icon = opsForKind(row.kind!).icon}
          <span class="tree-icon"><Icon class="h-3.5 w-3.5" /></span>
          {#if row.role === 'wires'}
            <span class="tree-label">wires</span>
            <span class="tree-kind">{row.count}</span>
          {:else}
            <!-- The label is what the canvas draws, so it leads; an empty one draws the name. -->
            <span class="tree-label">{row.label === '' ? row.name : row.label}</span>
            {#if row.label !== '' && row.label !== row.name}
              <span class="tree-name">{row.name}</span>
            {/if}
            <span class="tree-kind">{row.kind}</span>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  /*
    Every class here is `tree-` prefixed. The checks select a handful of unscoped class names
    across the whole page (`.footer`, `.grip`, `.veil`, ...), and a row that happened to share
    one would be counted as something it is not.
  */
  .tree-pane {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    background: var(--color-panel);
  }

  .tree-scroll {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem 0;
    font-size: 0.75rem;
    user-select: none;
  }

  .tree-row {
    display: flex;
    height: 1.5rem;
    align-items: center;
    gap: 0.375rem;
    padding-right: 0.5rem;
    color: var(--color-ink);
    cursor: default;
    white-space: nowrap;
  }

  .tree-row:hover {
    background: rgb(255 255 255 / 0.05);
  }

  .tree-row:focus {
    outline: none;
  }

  .tree-row:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: -1px;
  }

  .tree-selected,
  .tree-selected:hover {
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
  }

  .tree-twisty {
    display: flex;
    width: 0.875rem;
    flex-shrink: 0;
    justify-content: center;
    color: var(--color-ink-dim);
    transition: transform 80ms;
  }

  .tree-open {
    transform: rotate(90deg);
  }

  .tree-title {
    font-weight: 600;
  }

  .tree-icon {
    display: flex;
    flex-shrink: 0;
    color: var(--color-ink-dim);
  }

  .tree-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tree-name {
    min-width: 0;
    overflow: hidden;
    color: var(--color-ink-dim);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    text-overflow: ellipsis;
  }

  .tree-kind {
    margin-left: auto;
    padding-left: 0.5rem;
    color: var(--color-ink-dim);
    font-size: 0.6875rem;
    opacity: 0.7;
  }
</style>
