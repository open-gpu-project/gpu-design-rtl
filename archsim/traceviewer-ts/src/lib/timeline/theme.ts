/**
 * Colours and metrics for the trace panel's canvas.
 *
 * A sibling of `canvas/theme.ts` rather than an extension of it: the two renderers share no
 * tokens beyond the background, and `Theme` is injected into `Renderer` by the session, so
 * widening it would force every diagram token onto the timeline and vice versa.
 *
 * The values echo the Tailwind `@theme` tokens in `app.css` by hand. There is deliberately no
 * runtime `getComputedStyle` bridge between the two palettes -- the canvas is painted from
 * plain data, not from the cascade.
 */
export interface TimelineTheme {
  readonly background: string;
  readonly timescaleBg: string;
  readonly timescaleBorder: string;

  readonly gutterBg: string;
  readonly gutterBorder: string;
  readonly gutterText: string;
  readonly gutterTextDim: string;

  readonly rowEven: string;
  readonly rowOdd: string;
  readonly rowSelected: string;
  readonly rowSeparator: string;

  readonly tickMinor: string;
  readonly tickMedium: string;
  readonly tickMajor: string;
  readonly tickLabel: string;

  readonly stem: string;
  readonly stemSelected: string;
  readonly flagFill: string;
  readonly flagStroke: string;
  readonly flagText: string;
  readonly flagFillSelected: string;
  readonly flagStrokeSelected: string;
  readonly flagTextSelected: string;

  readonly cursor: string;
  readonly cursorHandleFill: string;
  readonly cursorHandleText: string;
}

export const darkTimelineTheme: TimelineTheme = {
  background: '#0f1115',
  timescaleBg: '#12151c',
  timescaleBorder: '#262c38',

  gutterBg: '#161a22',
  gutterBorder: '#262c38',
  gutterText: '#dbe3ef',
  gutterTextDim: '#8a94a6',

  rowEven: 'rgba(0, 0, 0, 0)',
  rowOdd: 'rgba(255, 255, 255, 0.022)',
  // Faint on purpose: it marks the row without competing with the flags drawn on top of it.
  rowSelected: 'rgba(96, 165, 250, 0.12)',
  rowSeparator: '#1b202a',

  tickMinor: '#272c36',
  tickMedium: '#333b4a',
  tickMajor: '#454e61',
  tickLabel: '#8a94a6',

  stem: '#60a5fa',
  stemSelected: '#fbbf24',
  flagFill: 'rgba(96, 165, 250, 0.20)',
  flagStroke: '#60a5fa',
  flagText: '#dbe3ef',
  flagFillSelected: 'rgba(251, 191, 36, 0.24)',
  flagStrokeSelected: '#fbbf24',
  flagTextSelected: '#fef3c7',

  // Yellow, and deliberately not the amber selection colour: the cursor and a selected flag are
  // routinely on screen together and must not read as the same thing.
  cursor: '#facc15',
  cursorHandleFill: '#facc15',
  cursorHandleText: '#0f1115',
};

/* ------------------------------------------------------------------------ metrics ---- */

/** Row height in CSS px. A flag occupies the upper half, so this is twice the flag height. */
export const ROW_H = 30;

/** Height of the timescale strip along the top. */
export const TIMESCALE_H = 24;

/** Default width of the frozen name column. */
export const GUTTER_W = 200;
export const GUTTER_MIN_W = 96;
export const GUTTER_MAX_W = 520;

/** Minimum on-screen spacing of minor ticks before the ladder coarsens. */
export const MIN_TICK_PX = 7;

/** Minimum spacing between labelled major ticks. Wide enough for a six-digit tick number. */
export const MIN_MAJOR_PX = 78;

/** Below this much free width a flag is drawn as a bare stem: no body, no text. */
export const FLAG_MIN_PX = 26;

/** Flag body height, and the vertical inset of a row's content. */
export const FLAG_H = 14;

/** Zoom range, in CSS pixels per tick. */
export const ZT_MIN = 0.002;
export const ZT_MAX = 64;

/** Grab tolerances, in CSS pixels. */
export const CURSOR_HIT_PX = 6;
export const FLAG_HIT_PX = 5;
export const GUTTER_EDGE_HIT_PX = 4;

/** Keep this much clear space when scrolling the cursor back into view. */
export const REVEAL_MARGIN_PX = 64;

/** A flag body never grows past this, however long its text. */
export const FLAG_MAX_W = 132;

/** Horizontal padding inside a flag body, both sides combined. */
export const FLAG_PAD_X = 10;

/**
 * The flag label's font.
 *
 * Exported because the hit test measures with it too: a flag is sized to its text, so the
 * clickable box cannot be computed without the same metrics the renderer used.
 */
export const FLAG_FONT = '11px ui-sans-serif, system-ui, sans-serif';

/* -------------------------------------------------------------------------- the cursor ---- */

/**
 * The cursor's readout font, and the per-character estimate to fall back on.
 *
 * Exported for the same reason `FLAG_FONT` is: the cursor's flag is sized to the tick it shows,
 * so the box you can grab has to be measured with the font the box was drawn with.
 */
export const CURSOR_FONT = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
export const CURSOR_EST_CHAR_PX = 6;

/** Cursor flag body height, and the padding either side of the tick inside it. */
export const CURSOR_FLAG_H = 15;
export const CURSOR_FLAG_PAD_X = 5;

/** Gap between the top of the timescale strip and the top of the cursor flag. */
export const CURSOR_FLAG_TOP = 2;

/**
 * Most records one row will walk in a frame.
 *
 * Above this the row is sampled with a stride. At that density every pixel already holds
 * several stems, so nothing distinguishable is lost -- but without the cap a zoomed-out row
 * with a million records would walk all of them, sixty times a second.
 */
export const MAX_SCAN_PER_ROW = 4000;
