<script lang="ts">
  import TimelineSurface from '../components/TimelineSurface.svelte';
  import { useSession } from '../lib/session.svelte';

  const session = useSession();
  const { trace, timeline, timelineHost, timelineRenderer } = session;

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
        title="First event on the selected trace (Home)"
        aria-label="First event"
        onclick={() => jump('first')}
      >
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 5 9 12l9 7z" /><path d="M6 5v14" />
        </svg>
      </button>
      <button
        class={btn}
        title="Previous event on the selected trace (Left arrow)"
        aria-label="Previous event"
        onclick={() => step(-1)}
      >
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 5 8 12l7 7" />
        </svg>
      </button>
      <button
        class={btn}
        title="Next event on the selected trace (Right arrow)"
        aria-label="Next event"
        onclick={() => step(1)}
      >
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <button
        class={btn}
        title="Last event on the selected trace (End)"
        aria-label="Last event"
        onclick={() => jump('last')}
      >
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 5l9 7-9 7z" /><path d="M18 5v14" />
        </svg>
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
      <button class={btn} title="Zoom out" aria-label="Zoom out" onclick={() => zoom(-2)}>
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" /><path d="M8 11h6M20 20l-4.5-4.5" />
        </svg>
      </button>
      <button class={btn} title="Zoom in" aria-label="Zoom in" onclick={() => zoom(2)}>
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" /><path d="M8 11h6M11 8v6M20 20l-4.5-4.5" />
        </svg>
      </button>
      <button class={btn} title="Fit the whole trace (Cmd+1)" aria-label="Fit trace" onclick={fit}>
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
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
    <TimelineSurface {trace} view={timeline} host={timelineHost} renderer={timelineRenderer} />
  </div>
</div>
