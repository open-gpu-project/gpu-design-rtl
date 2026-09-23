/** Colors used by the canvas renderer. DOM chrome is styled with Tailwind, not from here. */
export interface Theme {
  readonly background: string;
  readonly gridDotMinor: string;
  readonly gridDotMajor: string;
  readonly shapeFill: string;
  readonly shapeStroke: string;
  readonly shapeStrokeSelected: string;
  readonly shapeLabel: string;
  /** The second line of an inset label. Quieter than `shapeLabel`: the label is the subject. */
  readonly shapeSubtitle: string;
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
  /**
   * The marquee band. Amber, because that is already what this canvas means by "selected"
   * (`shapeStrokeSelected`, `handleStroke`), and the band is selection in progress.
   */
  readonly marqueeStroke: string;
  readonly marqueeFill: string;
}

export const darkTheme: Theme = {
  background: '#0f1115',
  gridDotMinor: '#272c36',
  gridDotMajor: '#404859',
  shapeFill: 'rgba(96, 165, 250, 0.14)',
  shapeStroke: '#60a5fa',
  shapeStrokeSelected: '#fbbf24',
  shapeLabel: '#dbe3ef',
  shapeSubtitle: '#93a1b8',
  ghostFill: 'rgba(96, 165, 250, 0.08)',
  ghostStroke: '#7dd3fc',
  handleFill: '#0f1115',
  handleStroke: '#fbbf24',
  connStroke: '#94a3b8',
  connStrokeSelected: '#fbbf24',
  connLabel: '#cbd5e1',
  anchorDotFill: '#fbbf24',
  anchorDotStroke: '#0f1115',
  marqueeStroke: '#fbbf24',
  marqueeFill: 'rgba(251, 191, 36, 0.10)',
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

/** Inset label and subtitle sizes, in CSS pixels. The label leads, so it is the larger one. */
export const LABEL_FONT_PX = 13;
export const SUBTITLE_FONT_PX = 10;

/** Baseline separation between an inset label and its subtitle, in CSS pixels. */
export const INSET_LINE_GAP_PX = 14;

/**
 * Clearance inset text keeps from the block's outline, per side, on all four sides.
 *
 * The rule this replaced reserved a 44 CSS px square before it would draw 13px type, and spent
 * the difference on emptiness: a 30px block drew an 8.9px label with 11.7px of nothing above
 * and below it, 22% of the block inked. A block's height is now a budget to spend rather than a
 * gate to clear, and this is the only part of that budget which is not type.
 *
 * Not scaled by anything. A margin that shrank with the block would be invisible exactly where
 * it was needed, and one that grew with it would be the padding this came out to remove.
 */
export const INSET_MARGIN_PX = 3;

/**
 * How much ink a line of inset type puts on the canvas above and below its drawing origin, as a
 * fraction of the font size.
 *
 * `textBaseline` is `'middle'`, which centres the EM BOX -- and the em box has slack at the top
 * and the bottom that no glyph ever reaches into. Budgeting height against the font size would
 * therefore reserve about a third more than the text can use.
 *
 * Measured, not read from the font's own metrics: Chrome rounds `fontBoundingBox` ascent and
 * descent to whole pixels, so their ratio moves by 5% across this range and in one place the
 * ascent FALLS as the size rises. These come from `actualBoundingBox` over printable ASCII and
 * hold to four decimals at every size from 8 to 16 px, which is the whole range inset type is
 * drawn at. Uppercase alone measures 0.400 / 0.337; the numbers here leave room for a descender
 * in the label and a pixel of antialias spill on each side.
 */
export const INSET_INK_ABOVE = 0.43;
export const INSET_INK_BELOW = 0.52;

/** Height of a line's ink, as a fraction of its font size. */
export const INSET_INK_H = INSET_INK_ABOVE + INSET_INK_BELOW;

/**
 * Blank between the label's descenders and the subtitle's ascenders, in CSS pixels.
 *
 * Derived rather than chosen, and that is the point: it is whatever is left of
 * `INSET_LINE_GAP_PX` once both lines' ink has been taken out of it, so two lines at full size
 * still sit exactly the gap apart and a block at ordinary zoom looks the way it always did.
 */
export const INSET_LEAD_PX =
  INSET_LINE_GAP_PX - INSET_INK_BELOW * LABEL_FONT_PX - INSET_INK_ABOVE * SUBTITLE_FONT_PX;

/**
 * The smallest inset type worth drawing, in CSS pixels. Below it the glyphs are grey mush and
 * the block reads better empty.
 *
 * One number doing two jobs: the size at which `insetType` stops offering a line, and the size
 * at which `fitInsetLine` stops shrinking one to make it fit the block's width and starts
 * cutting it instead. Two floors could drift apart, and the pair would then disagree about
 * whether a block has a label at all.
 */
export const INSET_TEXT_MIN_PX = 8;

/* ----------------------------------------------------------------------------- label tab ---- */

/** Height of a `tabbed_left` / `tabbed_right` label tab, in CSS pixels. */
export const TAB_H_PX = 15;

/** Font size inside a tab, and the horizontal padding either side of its text. */
export const TAB_FONT_PX = 10;
export const TAB_PAD_X_PX = 6;

/** Corner radius on the tab's two top corners, in CSS pixels. */
export const TAB_CORNER_R_PX = 3;

/** Inset from the block's corner to the near edge of the tab, in CSS pixels. */
export const TAB_INSET_PX = 4;

/**
 * A block must be at least this wide on screen before it gets a tab.
 *
 * Width only: a tab hangs above the block and so needs none of its height, which is the whole
 * point of the tabbed modes on a short block.
 */
export const TAB_MIN_W_PX = 32;

export const TAB_FONT = `${TAB_FONT_PX}px ui-sans-serif, system-ui, sans-serif`;

/** Per-character width estimate for a tab label with no canvas to measure against. */
export const TAB_EST_CHAR_PX = 5.6;

/* ------------------------------------------------------------------- connections ---- */

/**
 * The furthest, in CSS pixels, that anything may be drawn outside its shape's `bounds`.
 *
 * `bounds` is world-space geometry; strokes, arrowheads, knobs, label plates and a block's tab
 * are all sized in screen pixels and cannot be expressed there. The renderer expands the
 * viewport by this much before culling, so every one of them must fit inside it -- a decoration
 * that does not simply vanishes when its shape's own box leaves the screen.
 *
 * Big enough for the tab (`TAB_H_PX` above the block) and for a connection label pushed the
 * maximum `CONN_LABEL_OFFSET_MAX` off its run, with room left over. Overdrawing a few shapes
 * just outside the viewport costs far less than one invisible label.
 */
export const CULL_MARGIN_PX = 96;

/** Connection line width, in CSS pixels. */
export const CONN_WIDTH_PX = 1.5;
export const CONN_WIDTH_SEL_PX = 2.5;

/** Corner radius, in CSS pixels. Clamped per corner to half the shorter adjacent segment. */
export const CONN_CORNER_R_PX = 6;

/**
 * Bound on either component of a connection's `labelOffset`, in CSS pixels.
 *
 * Exists so the label cannot be pushed outside `CULL_MARGIN_PX` and disappear at the viewport
 * edge. Generous enough to clear anything a label realistically has to dodge.
 */
export const CONN_LABEL_OFFSET_MAX = 64;

/** Shortest run of a connection, in CSS pixels, worth hanging its label on. */
export const CONN_LABEL_MIN_RUN_PX = 44;

export const ARROW_LEN_PX = 9;
export const ARROW_HALF_W_PX = 4.5;

/**
 * How far the arrowhead's tip is discounted, in CSS pixels, when asking whether the head has
 * landed inside a block.
 *
 * The tip sits exactly ON the target's outline by construction, and `alignStroke` rounds it by
 * up to a device pixel while the projected block corner is not rounded at all. Without a
 * discount the head would read as overlapping its own target every time, at every zoom.
 *
 * Applied along the arrow's own axis and nowhere else. Deflating the block instead would be
 * the obvious alternative and is wrong: zoomed out far enough a block is two or three device
 * pixels across, which is precisely the case this is here to catch, and a deflated version of
 * it has no area left to test.
 */
export const ARROW_TIP_TOL_PX = 1.5;

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

/* ----------------------------------------------------------------------------- hover ---- */

/**
 * How long the pointer must sit still before a tooltip appears, in milliseconds.
 *
 * Long enough that crossing the canvas on the way somewhere else never raises one, short enough
 * that stopping on a block feels like it answered rather than like it hesitated.
 */
export const HOVER_DELAY_MS = 450;

/** How far the pointer may drift, in CSS pixels, before a shown tooltip is dismissed. */
export const HOVER_SLOP_PX = 4;

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
