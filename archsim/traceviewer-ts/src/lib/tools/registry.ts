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

export function registerTool(descriptor: ToolDescriptor): void {
  if (registry.has(descriptor.id)) {
    // Same reasoning as the shape registry: hot reload re-runs module side effects.
    if (!import.meta.env.DEV) throw new Error(`duplicate tool id: ${descriptor.id}`);
  }
  registry.set(descriptor.id, descriptor);
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
