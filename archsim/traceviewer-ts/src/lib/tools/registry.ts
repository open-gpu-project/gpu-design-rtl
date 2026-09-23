import { hint } from '../keys';
import type { Tool, ToolId } from './tool';

/**
 * Which cluster of the toolbar a tool sits in.
 *
 * `tool` is something you do to what is already there -- point at it, select it. `shape` adds
 * something new. They are separated by a rule in the toolbar because they answer different
 * questions, and which side of that rule a tool lands on is a fact about the tool, not about
 * the markup: putting it here means registering a tool is still the only step.
 */
export type ToolGroup = 'tool' | 'shape';

/** Clusters render left to right in this order. */
const GROUP_ORDER: readonly ToolGroup[] = ['tool', 'shape'];

/** What a tool declares about itself. */
export interface ToolDeclaration {
  readonly id: ToolId;
  readonly label: string;
  /** Inline SVG path data, drawn in a 24x24 viewBox by the toolbar. */
  readonly icon: string;
  readonly group: ToolGroup;
  /** Position within `group`, low to high. Gaps are fine; only the order matters. */
  readonly order: number;
  make(): Tool;
}

/** A declaration plus the digit its position in the toolbar earns it. */
export interface ToolDescriptor extends ToolDeclaration {
  readonly shortcut?: string;
}

const registry = new Map<ToolId, ToolDeclaration>();

/** Built on demand from `registry`, and dropped whenever a registration changes it. */
let ordered: readonly ToolDescriptor[] | null = null;
let grouped: readonly (readonly ToolDescriptor[])[] | null = null;
let byShortcut: Map<string, ToolDescriptor> | null = null;

export function registerTool(declaration: ToolDeclaration): void {
  if (registry.has(declaration.id)) {
    // Same reasoning as the shape registry: hot reload re-runs module side effects.
    if (!import.meta.env.DEV) throw new Error(`duplicate tool id: ${declaration.id}`);
  }
  registry.set(declaration.id, declaration);
  ordered = null;
  grouped = null;
  byShortcut = null;
}

/**
 * Every tool in toolbar order, each carrying the digit that selects it.
 *
 * The digit is ASSIGNED here, from the position, rather than declared by the tool. A declared
 * one is a second place the order is written down, and two places disagree: the toolbar would
 * read left to right as 1, 2, 4, 3 the first time someone inserted a tool and renumbered only
 * the neighbours they were looking at. Deriving it means the keys count across the toolbar by
 * construction, which is the whole of the guarantee.
 *
 * Past the ninth tool there is no digit left to give, so those get none and `toolTipText`
 * renders them as a bare label. Ten tools is well beyond what this toolbar is for.
 */
function build(): readonly ToolDescriptor[] {
  if (ordered === null) {
    ordered = [...registry.values()]
      .sort(
        (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.order - b.order,
      )
      .map((d, i) => (i < 9 ? { ...d, shortcut: String(i + 1) } : { ...d }));
  }
  return ordered;
}

/**
 * The tool a bare digit selects, or null.
 *
 * `shortcut` used to be tooltip decoration while `ToolHost` carried its own hardcoded switch,
 * which meant the toolbar could advertise a key that did nothing. Reading the declaration is
 * what makes registering a tool genuinely the only step.
 */
export function toolForShortcut(key: string): ToolDescriptor | null {
  if (byShortcut === null) {
    byShortcut = new Map();
    for (const d of build()) {
      if (d.shortcut !== undefined) byShortcut.set(d.shortcut, d);
    }
  }
  return byShortcut.get(key) ?? null;
}

/**
 * What a tool's tooltip says: `Rectangle (3)`, or just `Rectangle` with no shortcut assigned.
 *
 * Here rather than in the toolbar's markup because the shortcut in those parentheses has to be
 * the one `toolForShortcut` actually answers to. Building the string next to the lookup is what
 * keeps the toolbar from advertising a key that does nothing -- the same failure the `shortcut`
 * field was moved into this file to end.
 */
export function toolTipText(d: ToolDescriptor): string {
  return d.shortcut === undefined ? d.label : hint(d.label, d.shortcut);
}

/** Every tool, flat and in toolbar order. The keyboard path wants one list, not clusters. */
export function allTools(): readonly ToolDescriptor[] {
  return build();
}

/** The same tools, split into the clusters the toolbar draws a rule between. */
export function toolGroups(): readonly (readonly ToolDescriptor[])[] {
  if (grouped === null) {
    const out: ToolDescriptor[][] = [];
    let group: ToolGroup | null = null;
    for (const d of build()) {
      if (d.group !== group) {
        out.push([]);
        group = d.group;
      }
      out[out.length - 1]!.push(d);
    }
    grouped = out;
  }
  return grouped;
}

export function toolDescriptor(id: ToolId): ToolDescriptor {
  const d = build().find((t) => t.id === id);
  if (d === undefined) throw new Error(`no tool registered with id: ${id}`);
  return d;
}
