/** Colors used by the canvas renderer. DOM chrome is styled with Tailwind, not from here. */
export interface Theme {
  readonly background: string;
  readonly gridDotMinor: string;
  readonly gridDotMajor: string;
  readonly shapeFill: string;
  readonly shapeStroke: string;
  readonly shapeStrokeSelected: string;
  readonly shapeLabel: string;
  readonly ghostFill: string;
  readonly ghostStroke: string;
  readonly handleFill: string;
  readonly handleStroke: string;
  /** Connections are deliberately quieter than blocks: the blocks are the subject. */
  readonly connStroke: string;
  readonly connStrokeSelected: string;
  readonly connLabel: string;
  /**
   * The bead marking where a connection anchors: shown by the connect tool under the cursor,
   * and on both ends of a selected connection, where it is also the grab handle.
   */
  readonly anchorDotFill: string;
  /** Matches `background`, so the dot reads as a bead sitting on the edge rather than a blob. */
  readonly anchorDotStroke: string;
}

export const darkTheme: Theme = {
  background: '#0f1115',
  gridDotMinor: '#272c36',
  gridDotMajor: '#404859',
  shapeFill: 'rgba(96, 165, 250, 0.14)',
  shapeStroke: '#60a5fa',
  shapeStrokeSelected: '#fbbf24',
  shapeLabel: '#dbe3ef',
  ghostFill: 'rgba(96, 165, 250, 0.08)',
  ghostStroke: '#7dd3fc',
  handleFill: '#0f1115',
  handleStroke: '#fbbf24',
  connStroke: '#94a3b8',
  connStrokeSelected: '#fbbf24',
  connLabel: '#cbd5e1',
  anchorDotFill: '#fbbf24',
  anchorDotStroke: '#0f1115',
};

/* ---------------------------------------------------------------- interaction constants ---- */

/** Grab radius for any handle, in CSS pixels. Constant on screen at every zoom. */
export const HANDLE_HIT_R_PX = 8;

/** Drawn size of a corner knob, in CSS pixels. */
export const HANDLE_SIZE_PX = 7;

/** Grab distance from a stroked (unfilled) shape's outline, in CSS pixels. */
export const STROKE_HIT_PX = 6;

/** Movement below this (CSS px) is treated as a click, not a drag. */
export const DRAG_SLOP_PX = 4;

/** Minimum on-screen spacing for minor grid dots before the grid coarsens by MAJOR_EVERY. */
export const MIN_DOT_PX = 8;

/** A block must be at least this wide/tall on screen before its name is drawn. */
export const LABEL_MIN_PX = 44;

/* ------------------------------------------------------------------- connections ---- */

/** Connection line width, in CSS pixels. */
export const CONN_WIDTH_PX = 1.5;
export const CONN_WIDTH_SEL_PX = 2.5;

/** Corner radius, in CSS pixels. Clamped per corner to half the shorter adjacent segment. */
export const CONN_CORNER_R_PX = 6;

export const ARROW_LEN_PX = 9;
export const ARROW_HALF_W_PX = 4.5;

/** Drawn size of the mid-segment knob on a selected connection, in CSS pixels. */
export const CONN_KNOB_PX = 6;

/** How far outside a block's outline the perimeter still grabs, in CSS pixels. */
export const ANCHOR_HIT_PX = 10;

/**
 * Inside this band (CSS px) of the outline the anchor offset tracks the cursor. Deeper in, the
 * nearest face is ambiguous and jumpy, so the offset collapses to the face midpoint -- which
 * makes "click the middle of the target block" a stable gesture rather than a lottery.
 */
export const ANCHOR_BAND_PX = 14;

/**
 * Radius of the perimeter anchor bead, in CSS pixels. Round where the segment knob is square,
 * because one moves where the line attaches and the other moves the line.
 */
export const ANCHOR_DOT_R_PX = 4;

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 16;

/** Wheel-delta to zoom-exponent factors. Discrete notches use WHEEL_K, smooth pinches PINCH_K. */
export const WHEEL_K = 0.0015;
export const PINCH_K = 0.01;

/** Above this |deltaY| an event is treated as a discrete notch rather than a smooth gesture. */
export const DISCRETE_DELTA_PX = 40;

/**
 * Pressing an unselected block selects it and immediately starts a move, which is what every
 * other editor does. Set false to require a prior click to select, and pan otherwise.
 */
export const SELECT_ON_PRESS_BEGINS_MOVE = true;
