/**
 * Round a device-pixel coordinate so that a stroke of `widthDev` device pixels centred on it
 * lands on whole pixel boundaries. Odd widths need a half-pixel centre, even widths a whole one.
 */
export function alignStroke(vDev: number, widthDev: number): number {
  return widthDev % 2 === 1 ? Math.round(vDev) + 0.5 : Math.round(vDev);
}
