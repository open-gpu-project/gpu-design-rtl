import type { Component } from 'svelte';
import type { PanelId } from '../session.svelte';

export interface PanelDescriptor {
  /** Matches the `id` of the `DockPane` that hosts it, and is what a saved layout stores. */
  readonly id: PanelId;
  readonly title: string;
  /** Rendered inside the dock pane. Takes no props: it reads the session from context. */
  readonly component: Component<Record<string, never>>;
  /** A pane the user should not be able to close. Default true (closable). */
  readonly closable?: boolean;
  /** Floor for this panel's pane, in px along the split axis. */
  readonly minSize?: number;
}

const registry = new Map<PanelId, PanelDescriptor>();

export function registerPanel(d: PanelDescriptor): void {
  if (registry.has(d.id)) {
    // Same reasoning as the shape and tool registries: HMR re-runs module side effects.
    if (!import.meta.env.DEV) throw new Error(`duplicate panel id: ${d.id}`);
  }
  registry.set(d.id, d);
}

/**
 * Returns `undefined` rather than throwing, unlike `opsForKind` and `toolDescriptor`.
 *
 * Deliberate: a persisted layout can name a panel that no longer exists in this build, and
 * throwing there would brick the app on every reload with no way back short of devtools.
 * The shell renders a visible placeholder instead.
 */
export function panelFor(id: PanelId): PanelDescriptor | undefined {
  return registry.get(id);
}

export function allPanels(): readonly PanelDescriptor[] {
  return [...registry.values()];
}
