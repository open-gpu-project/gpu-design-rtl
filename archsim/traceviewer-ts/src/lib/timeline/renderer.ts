import { alignStroke } from '../canvas/pixel';
import { localName, type SignalId, type Tick, type TraceDoc } from '../trace/model';
import type { SelectedEvent } from '../trace/store.svelte';
import { flagMeasurer, visibleFlags, type FlagBox } from './layout';
import { FLAG_FONT, FLAG_H, ROW_H, TIMESCALE_H, type TimelineTheme } from './theme';
import { firstIndexAtOrAfter, formatTick, tickTiers } from './ticks';
import type { TimelineView } from './view.svelte';

export interface TimelineRenderInput {
  readonly doc: TraceDoc;
  readonly rows: readonly SignalId[];
  readonly cursorTick: Tick;
  readonly selectedSignal: SignalId | null;
  readonly selectedEvent: SelectedEvent | null;
}

const FONT = 'ui-sans-serif, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** Truncate to fit `maxW`, with an ellipsis. Returns '' when not even the ellipsis fits. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  const ell = '…';
  if (ctx.measureText(ell).width > maxW) return '';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? ell : text.slice(0, lo) + ell;
}

/**
 * Drop leading path segments until the name fits, so the informative tail survives.
 *
 * `top.cluster.xu_3.primary_bus` becomes `...xu_3.primary_bus` rather than `top.cluster.x...`,
 * which is the half nobody can tell apart from its neighbours.
 */
function fitSignalName(ctx: CanvasRenderingContext2D, name: string, maxW: number): string {
  if (ctx.measureText(name).width <= maxW) return name;
  const parts = name.split('.');
  for (let i = 1; i < parts.length; i++) {
    const tail = '…' + parts.slice(i).join('.');
    if (ctx.measureText(tail).width <= maxW) return tail;
  }
  return fitText(ctx, localName(name), maxW);
}

/**
 * The trace panel's render loop.
 *
 * Same structure as `canvas/renderer.ts` and for the same reason: **nothing draws inside an
 * `$effect`**. The effect in `TimelineSurface` reads an explicit dependency list and marks
 * dirty; this does the work, untracked, once per animation frame.
 */
export class TimelineRenderer {
  #dirty = false;
  #raf = 0;

  constructor(
    private readonly view: TimelineView,
    private readonly theme: TimelineTheme,
    private readonly getInput: () => TimelineRenderInput,
  ) {}

  requestFrame(): void {
    this.#dirty = true;
    if (this.#raf !== 0) return;
    this.#raf = requestAnimationFrame(this.#tick);
  }

  dispose(): void {
    if (this.#raf !== 0) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#dirty = false;
  }

  #tick = (): void => {
    this.#raf = 0;
    if (!this.#dirty) return;
    this.#dirty = false;
    this.draw();
  };

  draw(): void {
    const view = this.view;
    const ctx = view.ctx;
    if (ctx === null || view.cssW <= 0 || view.cssH <= 0) return;

    const { cssW, cssH, dpr } = view;
    const t = this.theme;
    const input = this.getInput();

    const css = (): void => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const device = (): void => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    css();
    ctx.fillStyle = t.background;
    ctx.fillRect(0, 0, cssW, cssH);

    // Gutter background, full height. The corner above it doubles as the column header.
    ctx.fillStyle = t.gutterBg;
    ctx.fillRect(0, 0, view.laneX, cssH);

    this.#drawRows(ctx, input, css, device);
    this.#drawLane(ctx, input, css, device);
    this.#drawGutter(ctx, input);
    this.#drawTimescale(ctx, input, css, device);
    this.#drawCursor(ctx, input, css, device);

    css();
  }

  /* ------------------------------------------------------- row backgrounds ---- */

  #drawRows(
    ctx: CanvasRenderingContext2D,
    input: TimelineRenderInput,
    css: () => void,
    device: () => void,
  ): void {
    const view = this.view;
    const t = this.theme;

    css();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, view.laneTop, view.cssW, view.laneH);
    ctx.clip();

    const first = Math.max(0, Math.floor(view.scrollY / ROW_H));
    const last = Math.min(input.rows.length - 1, Math.ceil((view.scrollY + view.laneH) / ROW_H));

    for (let i = first; i <= last; i++) {
      const y = view.rowY(i);
      const selected = input.rows[i] === input.selectedSignal;
      // Stripes span the gutter too: a row is one thing, and a highlight that stopped at the
      // gutter edge would read as two.
      ctx.fillStyle = selected ? t.rowSelected : i % 2 === 1 ? t.rowOdd : t.rowEven;
      if (selected || i % 2 === 1) ctx.fillRect(0, y, view.cssW, ROW_H);
    }

    // Separators in device space: a 1px line at a fractional y is a two-pixel grey smudge.
    device();
    const w = Math.max(1, Math.round(view.dpr));
    ctx.strokeStyle = t.rowSeparator;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let i = first; i <= last; i++) {
      const y = alignStroke((view.rowY(i) + ROW_H) * view.dpr, w);
      ctx.moveTo(0, y);
      ctx.lineTo(view.cssW * view.dpr, y);
    }
    ctx.stroke();

    css();
    ctx.restore();
  }

  /* --------------------------------------------------- ticks and the flags ---- */

  #drawLane(
    ctx: CanvasRenderingContext2D,
    input: TimelineRenderInput,
    css: () => void,
    device: () => void,
  ): void {
    const view = this.view;
    if (view.laneW <= 0) return;

    css();
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.laneX, view.laneTop, view.laneW, view.laneH);
    ctx.clip();

    this.#drawGridlines(ctx, device, view.laneTop, view.cssH);

    css();
    this.#drawFlags(ctx, input);

    css();
    ctx.restore();
  }

  /**
   * Vertical gridlines, three tiers, in device-pixel space.
   *
   * Ticks are walked by **index** (`i * step`), never by adding `step` to a running coordinate:
   * the `tick % coarser === 0` test that stops a tier drawing over a coarser one has to stay
   * exact, and repeated addition drifts.
   */
  #drawGridlines(
    ctx: CanvasRenderingContext2D,
    device: () => void,
    top: number,
    bottom: number,
  ): void {
    const view = this.view;
    const t = this.theme;
    const tiers = tickTiers(view.zT);
    const dpr = view.dpr;

    device();
    const w = Math.max(1, Math.round(dpr));
    ctx.lineWidth = w;

    const topDev = top * dpr;
    const botDev = bottom * dpr;

    const pass = (step: number, coarser: number, colour: string, alpha: number): void => {
      if (alpha <= 0) return;
      const stepDev = step * view.zT * dpr;
      if (!Number.isFinite(stepDev) || stepDev < 2) return;

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      for (let i = firstIndexAtOrAfter(view.camT, step); ; i++) {
        const tick = i * step;
        const x = view.toX(tick);
        if (x > view.cssW) break;
        if (coarser > 0 && tick % coarser === 0) continue;
        const xd = alignStroke(x * dpr, w);
        ctx.moveTo(xd, topDev);
        ctx.lineTo(xd, botDev);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    if (tiers.minor < tiers.medium) pass(tiers.minor, tiers.medium, t.tickMinor, tiers.minorAlpha);
    if (tiers.medium < tiers.major) pass(tiers.medium, tiers.major, t.tickMedium, 1);
    pass(tiers.major, 0, t.tickMajor, 1);
  }

  #drawFlags(ctx: CanvasRenderingContext2D, input: TimelineRenderInput): void {
    const view = this.view;
    const sel = input.selectedEvent;

    const first = Math.max(0, Math.floor(view.scrollY / ROW_H));
    const last = Math.min(input.rows.length - 1, Math.ceil((view.scrollY + view.laneH) / ROW_H));

    // Created once: it sets the font, and nothing between here and the end of the loop changes
    // it. The hit test builds the same measurer, which is what keeps the drawn box and the
    // clickable box identical.
    const measure = flagMeasurer(ctx);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    for (let i = first; i <= last; i++) {
      const id = input.rows[i]!;
      const signal = input.doc.signals[id];
      const track = input.doc.tracks[id];
      if (signal === undefined || track === undefined) continue;

      const rowTop = view.rowY(i);
      const boxes = visibleFlags(view, track, signal, measure);
      const isSelRow = sel !== null && sel.signal === id;

      for (const b of boxes) {
        this.#drawFlag(ctx, b, rowTop, isSelRow && sel.tick === b.tick);
      }
    }
  }

  #drawFlag(ctx: CanvasRenderingContext2D, b: FlagBox, rowTop: number, selected: boolean): void {
    const t = this.theme;
    const top = rowTop + 2;
    const bot = rowTop + ROW_H - 2;

    // The stem marks the exact time and runs the full height of the row; the flag hangs off its
    // upper half. Drawn in CSS space -- a 1px stem is allowed to be soft, and aligning every
    // stem to a device pixel would move it off the tick it exists to point at.
    ctx.strokeStyle = selected ? t.stemSelected : t.stem;
    ctx.lineWidth = selected ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(b.x, top);
    ctx.lineTo(b.x, bot);
    ctx.stroke();

    if (b.w <= 0) return;

    ctx.fillStyle = selected ? t.flagFillSelected : t.flagFill;
    ctx.strokeStyle = selected ? t.flagStrokeSelected : t.flagStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(b.x, top, b.w, FLAG_H);
    ctx.fill();
    ctx.stroke();

    // The box was sized from this text, so this only truncates where the next stem cut it off.
    ctx.font = FLAG_FONT;
    const text = fitText(ctx, b.label, b.w - 8);
    if (text !== '') {
      ctx.fillStyle = selected ? t.flagTextSelected : t.flagText;
      ctx.fillText(text, b.x + 4, top + FLAG_H / 2 + 0.5);
    }
  }

  /* ------------------------------------------------------------- the gutter ---- */

  #drawGutter(ctx: CanvasRenderingContext2D, input: TimelineRenderInput): void {
    const view = this.view;
    const t = this.theme;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, view.laneTop, view.laneX, view.laneH);
    ctx.clip();

    ctx.font = `11px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const first = Math.max(0, Math.floor(view.scrollY / ROW_H));
    const last = Math.min(input.rows.length - 1, Math.ceil((view.scrollY + view.laneH) / ROW_H));

    for (let i = first; i <= last; i++) {
      const id = input.rows[i]!;
      const signal = input.doc.signals[id];
      if (signal === undefined) continue;
      const selected = id === input.selectedSignal;
      ctx.fillStyle = selected ? t.gutterText : t.gutterTextDim;
      const text = fitSignalName(ctx, signal.name, view.laneX - 16);
      ctx.fillText(text, 10, view.rowY(i) + ROW_H / 2 + 0.5);
    }

    ctx.restore();

    // Header corner, then the border, so the border sits above both.
    ctx.fillStyle = t.gutterBg;
    ctx.fillRect(0, 0, view.laneX, TIMESCALE_H);
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = t.gutterTextDim;
    ctx.textBaseline = 'middle';
    ctx.fillText('Signal', 10, TIMESCALE_H / 2 + 0.5);

    const dpr = view.dpr;
    const w = Math.max(1, Math.round(dpr));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = t.gutterBorder;
    ctx.lineWidth = w;
    ctx.beginPath();
    const xd = alignStroke(view.laneX * dpr, w);
    ctx.moveTo(xd, 0);
    ctx.lineTo(xd, view.cssH * dpr);
    ctx.stroke();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------------------------------------------------- the timescale ---- */

  #drawTimescale(
    ctx: CanvasRenderingContext2D,
    _input: TimelineRenderInput,
    css: () => void,
    device: () => void,
  ): void {
    const view = this.view;
    const t = this.theme;
    if (view.laneW <= 0) return;

    css();
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.laneX, 0, view.laneW, TIMESCALE_H);
    ctx.clip();

    ctx.fillStyle = t.timescaleBg;
    ctx.fillRect(view.laneX, 0, view.laneW, TIMESCALE_H);

    const tiers = tickTiers(view.zT);
    const dpr = view.dpr;

    // Ticks rise from the baseline, tallest for majors -- the ruler in the user's sketch.
    device();
    const w = Math.max(1, Math.round(dpr));
    ctx.lineWidth = w;

    const mark = (step: number, coarser: number, height: number, colour: string, alpha: number) => {
      if (alpha <= 0) return;
      const stepDev = step * view.zT * dpr;
      if (!Number.isFinite(stepDev) || stepDev < 2) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      for (let i = firstIndexAtOrAfter(view.camT, step); ; i++) {
        const tick = i * step;
        const x = view.toX(tick);
        if (x > view.cssW) break;
        if (coarser > 0 && tick % coarser === 0) continue;
        const xd = alignStroke(x * dpr, w);
        ctx.moveTo(xd, (TIMESCALE_H - height) * dpr);
        ctx.lineTo(xd, TIMESCALE_H * dpr);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    if (tiers.minor < tiers.medium)
      mark(tiers.minor, tiers.medium, 3, t.tickMinor, tiers.minorAlpha);
    if (tiers.medium < tiers.major) mark(tiers.medium, tiers.major, 6, t.tickMedium, 1);
    mark(tiers.major, 0, 10, t.tickMajor, 1);

    // Labels on majors only.
    css();
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = t.tickLabel;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (let i = firstIndexAtOrAfter(view.camT, tiers.major); ; i++) {
      const tick = i * tiers.major;
      const x = view.toX(tick);
      if (x > view.cssW) break;
      if (tick < 0) continue;
      ctx.fillText(formatTick(tick), x + 3, 3);
    }

    ctx.restore();

    // Baseline under the strip.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = t.timescaleBorder;
    ctx.lineWidth = w;
    ctx.beginPath();
    const yd = alignStroke(TIMESCALE_H * dpr, w);
    ctx.moveTo(view.laneX * dpr, yd);
    ctx.lineTo(view.cssW * dpr, yd);
    ctx.stroke();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* -------------------------------------------------------------- the cursor ---- */

  #drawCursor(
    ctx: CanvasRenderingContext2D,
    input: TimelineRenderInput,
    css: () => void,
    _device: () => void,
  ): void {
    const view = this.view;
    const t = this.theme;
    if (view.laneW <= 0) return;

    const x = view.toX(input.cursorTick);
    if (x < view.laneX - 1 || x > view.cssW + 1) return;

    css();
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.laneX, 0, view.laneW, view.cssH);
    ctx.clip();

    ctx.strokeStyle = t.cursor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, TIMESCALE_H);
    ctx.lineTo(x, view.cssH);
    ctx.stroke();

    // The handle: a triangle on the baseline plus the tick, as sketched.
    ctx.fillStyle = t.cursorHandleFill;
    ctx.beginPath();
    ctx.moveTo(x, TIMESCALE_H - 9);
    ctx.lineTo(x - 5, TIMESCALE_H);
    ctx.lineTo(x + 5, TIMESCALE_H);
    ctx.closePath();
    ctx.fill();

    const label = formatTick(input.cursorTick);
    ctx.font = `10px ${MONO}`;
    const tw = ctx.measureText(label).width;
    // Flip to the left of the cursor when the readout would run off the right edge.
    const pillW = tw + 8;
    const left = x + 7 + pillW <= view.cssW ? x + 7 : x - 7 - pillW;
    ctx.fillStyle = t.cursorHandleFill;
    ctx.fillRect(left, 2, pillW, 13);
    ctx.fillStyle = t.cursorHandleText;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(label, left + 4, 9);

    ctx.restore();
  }
}
