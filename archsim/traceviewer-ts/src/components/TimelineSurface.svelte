<script lang="ts">
  import { onMount } from 'svelte';
  import type { TimelineHost } from '../lib/timeline/host.svelte';
  import type { TimelineRenderer } from '../lib/timeline/renderer';
  import type { TimelineView } from '../lib/timeline/view.svelte';
  import type { TraceStore } from '../lib/trace/store.svelte';

  interface Props {
    trace: TraceStore;
    view: TimelineView;
    host: TimelineHost;
    renderer: TimelineRenderer;
  }

  const { trace, view, host, renderer }: Props = $props();

  let stageEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;

  /**
   * A zero-sized container means a hidden tab or a fully collapsed splitter pane. Skip both the
   * resize and the render rather than building a 0x0 bitmap that has to be rebuilt on return.
   */
  function applySize(cssW: number, cssH: number): void {
    const ok = view.syncCanvasSize(cssW, cssH, window.devicePixelRatio || 1);
    host.refreshRect();
    if (!ok) return;
    // The pane's width is unknown until now, so the initial fit cannot happen any earlier.
    if (!view.fitted) view.zoomToFit();
    renderer.requestFrame();
  }

  /**
   * Always `contentRect`, never `devicePixelContentBoxSize`: the latter is specified in device
   * pixels but Chromium reports it in CSS pixels under an emulated deviceScaleFactor, which
   * gave a canvas half the size of its container (iter-1 bug 2).
   */
  function measure(entry: ResizeObserverEntry): { w: number; h: number } {
    return { w: entry.contentRect.width, h: entry.contentRect.height };
  }

  /**
   * Moving a window between a Retina and an external display changes devicePixelRatio without
   * firing `resize`, so watch the ratio itself. The query has to be rebuilt after every change.
   */
  function watchDpr(onChange: () => void): () => void {
    let mq: MediaQueryList | null = null;
    let disposed = false;
    const handler = (): void => {
      if (disposed) return;
      onChange();
      attach();
    };
    const attach = (): void => {
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', handler, { once: true });
    };
    attach();
    return () => {
      disposed = true;
      mq?.removeEventListener('change', handler);
    };
  }

  onMount(() => {
    view.attach(canvasEl);
    host.attach(canvasEl, stageEl);

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const { w, h } = measure(entry);
      applySize(w, h);
    });
    ro.observe(stageEl);

    const stopDpr = watchDpr(() => applySize(view.cssW, view.cssH));

    const onKeyDown = (e: KeyboardEvent): void => host.onKeyDown(e);
    const onKeyUp = (e: KeyboardEvent): void => host.onKeyUp(e);
    const onBlur = (): void => host.onWindowBlur();
    const onVisibility = (): void => {
      if (document.hidden) host.onWindowBlur();
    };
    const onLayoutShift = (): void => host.refreshRect();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onLayoutShift);
    window.addEventListener('scroll', onLayoutShift, true);
    document.addEventListener('visibilitychange', onVisibility);

    // preventDefault is only honoured on a non-passive wheel listener, and without it macOS
    // rubber-bands the page and Chrome can trigger back-navigation on horizontal deltas.
    const onWheel = (e: WheelEvent): void => host.onWheel(e);
    canvasEl.addEventListener('wheel', onWheel, { passive: false });

    // Safari reports trackpad pinches through these instead of ctrl+wheel.
    const onGestureStart = (e: Event): void => host.onGestureStart(e);
    const onGestureChange = (e: Event): void => host.onGestureChange(e);
    const onGestureEnd = (e: Event): void => host.onGestureEnd(e);
    canvasEl.addEventListener('gesturestart', onGestureStart);
    canvasEl.addEventListener('gesturechange', onGestureChange);
    canvasEl.addEventListener('gestureend', onGestureEnd);

    applySize(stageEl.clientWidth, stageEl.clientHeight);

    return () => {
      ro.disconnect();
      stopDpr();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onLayoutShift);
      window.removeEventListener('scroll', onLayoutShift, true);
      document.removeEventListener('visibilitychange', onVisibility);
      canvasEl.removeEventListener('wheel', onWheel);
      canvasEl.removeEventListener('gesturestart', onGestureStart);
      canvasEl.removeEventListener('gesturechange', onGestureChange);
      canvasEl.removeEventListener('gestureend', onGestureEnd);
      host.detach(canvasEl);
      view.detach(canvasEl);
      renderer.dispose();
    };
  });

  /**
   * Mark dirty only. Drawing inside the effect would make every value the renderer reads a
   * tracked dependency and flush once per microtask instead of once per frame.
   */
  $effect(() => {
    void trace.doc;
    void trace.rows;
    void trace.cursorTick;
    void trace.selectedSignal;
    void view.camT;
    void view.zT;
    void view.scrollY;
    void view.gutterW;
    void view.cssW;
    void view.cssH;
    void view.dpr;
    void host.gestureVersion;
    renderer.requestFrame();
  });
</script>

<div bind:this={stageEl} class="stage">
  <canvas
    bind:this={canvasEl}
    class="surface"
    style:cursor={host.cursor}
    onpointerdown={(e) => host.onPointerDown(e)}
    onpointermove={(e) => host.onPointerMove(e)}
    onpointerup={(e) => host.onPointerUp(e)}
    onpointercancel={() => host.onPointerCancel()}
    onpointerleave={() => host.onPointerLeave()}
    oncontextmenu={(e) => e.preventDefault()}
  ></canvas>
</div>

<style>
  .stage {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    contain: strict;
  }

  /* Sized in JS only. A percentage width here would stretch the bitmap instead of resizing it. */
  .surface {
    position: absolute;
    inset: 0;
    display: block;
    touch-action: none;
  }
</style>
