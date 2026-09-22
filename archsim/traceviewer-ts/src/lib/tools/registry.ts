import type { Tool, ToolId } from './tool';

export interface ToolDescriptor {
  readonly id: ToolId;
  readonly label: string;
  /** Inline SVG path data, drawn in a 24x24 viewBox by the toolbar. */
  readonly icon: string;
  readonly shortcut?: string;
  make(): Tool;
}

const registry = new Map<ToolId, ToolDescriptor>();

/** Built on demand from `registry`, and dropped whenever a registration changes it. */
let byShortcut: Map<string, ToolDescriptor> | null = null;

export function registerTool(descriptor: ToolDescriptor): void {
  if (registry.has(descriptor.id)) {
    // Same reasoning as the shape registry: hot reload re-runs module side effects.
    if (!import.meta.env.DEV) throw new Error(`duplicate tool id: ${descriptor.id}`);
  }
  registry.set(descriptor.id, descriptor);
  byShortcut = null;
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
    for (const d of registry.values()) {
      if (d.shortcut !== undefined) byShortcut.set(d.shortcut, d);
    }
  }
  return byShortcut.get(key) ?? null;
}

/** The toolbar renders this directly, so a new tool appears just by registering itself. */
export function allTools(): readonly ToolDescriptor[] {
  return [...registry.values()];
}

export function toolDescriptor(id: ToolId): ToolDescriptor {
  const d = registry.get(id);
  if (d === undefined) throw new Error(`no tool registered with id: ${id}`);
  return d;
}
