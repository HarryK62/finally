/**
 * Diverging fill ramp for the portfolio heatmap.
 *
 * Two hues around a neutral gray midpoint — never a rainbow. Magnitude is
 * clamped at ±5%, which is where an intraday position stops reading as "a bit
 * up" and starts reading as "moved"; beyond that the cell is already at full
 * saturation and extra range would only compress the middle of the scale.
 *
 * Red/green is unreadable for deuteranopes, so every cell that uses this ramp
 * must also print its signed percentage — the color is the fast scan, the
 * number is the ground truth.
 */

/** Neutral midpoint. Deliberately gray, not a hue. */
const NEUTRAL: RGB = [43, 50, 60];
const POSITIVE: RGB = [31, 122, 58];
const NEGATIVE: RGB = [166, 48, 47];

/** Full saturation at this magnitude, in percent. */
export const HEAT_CLAMP = 5;

type RGB = [number, number, number];

function lerp(from: RGB, to: RGB, t: number): RGB {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

function hex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** Fill for a P&L percentage. `0`, `null` and `NaN` all give the neutral step. */
export function heatFill(percent: number | null | undefined): string {
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent === 0) {
    return hex(NEUTRAL);
  }
  // Square-root easing: without it, almost every cell sits near the neutral end
  // of the ramp and the map reads as uniformly gray.
  const t = Math.sqrt(Math.min(Math.abs(percent), HEAT_CLAMP) / HEAT_CLAMP);
  return hex(lerp(NEUTRAL, percent > 0 ? POSITIVE : NEGATIVE, t));
}

/** Border for a heat cell — one step brighter than its fill, for definition. */
export function heatStroke(percent: number | null | undefined): string {
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent === 0) {
    return "#3a434f";
  }
  return percent > 0 ? "#2ea043" : "#cf3f3a";
}
