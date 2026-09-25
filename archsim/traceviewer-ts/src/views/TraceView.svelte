<script lang="ts">
  // One module per icon, and never a `title` prop -- see `Toolbar.svelte`, which follows the
  // same two rules for the same reasons.
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Maximize from '@lucide/svelte/icons/maximize';
  import SkipBack from '@lucide/svelte/icons/skip-back';
  import SkipForward from '@lucide/svelte/icons/skip-forward';
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import CanvasSurface from '../components/CanvasSurface.svelte';
  import { hint } from '../lib/keys';
  import { useSession } from '../lib/session.svelte';
  import { tip } from '../lib/ui/tooltip.svelte';

  const session = useSession();
  const { trace, timeline, timelineHost, timelineRenderer } = session;

  // Everything a timeline frame reads, besides the canvas size the surface tracks itself.
  const track = (): void => {
    void trace.doc;
    void trace.rows;
    void trace.cursorTick;
    void trace.selectedSignal;
    void timeline.camT;
    void timeline.zT;
    void timeline.scrollY;
    void timeline.gutterW;
    void timelineHost.gestureVersion;
  };

  const btn =
    'flex h-7 w-7 items-center justify-center rounded text-[var(--color-ink-dim)] ' +
    'hover:bg-white/5 hover:text-[var(--color-ink)] disabled:opacity-30 ' +
    'disabled:hover:bg-transparent disabled:hover:text-[var(--color-ink-dim)]';
  const group = 'flex items-center gap-1 px-2';
  const divider = 'h-5 w-px bg-[var(--color-panel-border)]';

  const selectedSignal = $derived(
    trace.selectedSignal === null ? null : (trace.signalOf(trace.selectedSignal) ?? null),
  );

  /**
   * The tick field is not bound directly to `cursorTick`.
   *
   * A two-way binding would rewrite the box on every keystroke -- typing "12" to reach tick 120
   * would commit tick 1, then 12, dragging the cursor across the trace as you type. So the text
   * is local while focused, and only re-synced from the cursor when it is not.
   */
  let editing = $state(false);
  let tickText = $state('0');

  $effect(() => {
    const t = trace.cursorTick;
    if (!editing) tickText = String(t);
  });

  function commitTick(): void {
    const n = Number(tickText.trim());
    if (Number.isFinite(n)) {
      trace.setCursor(n);
      timeline.revealTick(trace.cursorTick);
      timelineRenderer.requestFrame();
    }
    tickText = String(trace.cursorTick);
  }

  function onTickKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      commitTick();
      (e.currentTarget as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      tickText = String(trace.cursorTick);
      (e.currentTarget as HTMLInputElement).blur();
    }
    // Arrow keys belong to the field while it has focus. `TimelineHost.onKeyDown` also filters
    // editable targets, so this is belt and braces rather than the only guard.
    e.stopPropagation();
  }

  function step(dir: 1 | -1): void {
    if (dir === 1) trace.nextEvent();
    else trace.prevEvent();
    timeline.revealTick(trace.cursorTick);
    timelineRenderer.requestFrame();
  }

  function jump(end: 'first' | 'last'): void {
    if (end === 'first') trace.firstEvent();
    else trace.lastEvent();
    timeline.revealTick(trace.cursorTick);
    timelineRenderer.requestFrame();
  }

  function zoom(steps: number): void {
    timeline.zoomByStep(steps);
    timelineRenderer.requestFrame();
  }

  function fit(): void {
    timeline.zoomToFit();
    timelineRenderer.requestFrame();
  }
</script>

<div class="flex h-full min-h-0 w-full flex-col">
  <div
    class="flex h-9 shrink-0 items-center border-b border-[var(--color-panel-border)]
           bg-[var(--color-panel)] text-sm select-none"
  >
    <div class={group}>
      <button
        class={btn}
        {@attach tip(hint('First event on the selected trace', 'home'))}
        aria-label="First event"
        onclick={() => jump('first')}
      >
        <SkipBack class="h-4 w-4" />
      </button>
      <button
        class={btn}
        {@attach tip(hint('Previous event on the selected trace', 'left'))}
        aria-label="Previous event"
        onclick={() => step(-1)}
      >
        <ChevronLeft class="h-4 w-4" />
      </button>
      <button
        class={btn}
        {@attach tip(hint('Next event on the selected trace', 'right'))}
        aria-label="Next event"
        onclick={() => step(1)}
      >
        <ChevronRight class="h-4 w-4" />
      </button>
      <button
        class={btn}
        {@attach tip(hint('Last event on the selected trace', 'end'))}
        aria-label="Last event"
        onclick={() => jump('last')}
      >
        <SkipForward class="h-4 w-4" />
      </button>
    </div>

    <div class={divider}></div>

    <label class="flex items-center gap-2 px-3 text-xs text-[var(--color-ink-dim)]">
      Tick
      <input
        data-testid="cursor-tick"
        class="h-6 w-24 rounded border border-[var(--color-panel-border)] bg-[var(--color-surface)]
               px-2 text-right font-mono text-xs text-[var(--color-ink)] tabular-nums
               focus:border-[var(--color-accent)] focus:outline-none"
        inputmode="numeric"
        bind:value={tickText}
        onfocus={() => (editing = true)}
        onblur={() => {
          editing = false;
          commitTick();
        }}
        onkeydown={onTickKey}
      />
      <span class="tabular-nums opacity-60">/ {trace.doc.lastTick}</span>
    </label>

    <div class={divider}></div>

    <div class={group}>
      <button class={btn} {@attach tip('Zoom out')} aria-label="Zoom out" onclick={() => zoom(-2)}>
        <ZoomOut class="h-4 w-4" />
      </button>
      <button class={btn} {@attach tip('Zoom in')} aria-label="Zoom in" onclick={() => zoom(2)}>
        <ZoomIn class="h-4 w-4" />
      </button>
      <button
        class={btn}
        {@attach tip(hint('Fit the whole trace', 'cmd', '1'))}
        aria-label="Fit trace"
        onclick={fit}
      >
        <Maximize class="h-4 w-4" />
      </button>
    </div>

    <span class="ml-auto truncate px-3 text-xs text-[var(--color-ink-dim)]">
      {#if selectedSignal !== null}
        <span class="text-[var(--color-ink)]">{selectedSignal.name}</span>
        {#if trace.selectedEvent !== null}
          &nbsp;&middot;&nbsp;{trace.selectedEvent.values.length}
          event{trace.selectedEvent.values.length === 1 ? '' : 's'} at {trace.selectedEvent.tick}
        {/if}
      {:else}
        {trace.rows.length} traces
      {/if}
    </span>
  </div>

  <div class="min-h-0 flex-1">
    <CanvasSurface view={timeline} host={timelineHost} renderer={timelineRenderer} {track} />
  </div>
</div>
