/**
 * The geometry of the bottom bar's centre notch.
 *
 * Pure on purpose, and in its own file with no React Native imports, so the
 * curve the tab bar draws can be measured and checked on its own — which is
 * what `backend/scripts/smoke_tab_bar_notch.ts` does. A scoop that only
 * exists inside a component is a scoop nobody can verify without a device,
 * and the two properties that matter here are geometric, not visual:
 *
 *   1. THE NOTCH MUST NOT REACH AN ICON. With four tabs the notch is centred
 *      in the gap between tab 2 and tab 3, but on a narrow screen a
 *      fixed-width scoop would still cut into them. `notchGeometry` clamps
 *      the half-width against the tab slot so that cannot happen.
 *
 *   2. THE SCOOP MUST STAY ABOVE THE ICON ROW. It cuts down from the top
 *      edge; the icons sit lower in the bar. `notchDepthAt` gives the curve's
 *      depth at any x, so the clearance is a number rather than a hope.
 *
 * The bar itself is drawn as an SVG path rather than a styled View because a
 * concave scoop is not something a border radius can express: `borderRadius`
 * only ever rounds a corner outwards.
 */

/** How deep the scoop cuts into the bar, at its deepest point. */
export const NOTCH_DEPTH = 26;

/** Rounding on the bar's two top corners. The bottom sits flush with the screen. */
export const BAR_RADIUS = 28;

/** Half-width of the scoop at the top edge, before clamping. */
export const NOTCH_HALF_WIDTH = 62;

/** How far the curve eases in on each side, as a share of the half-width. */
export const NOTCH_SHOULDER = 0.55;

/** The clearance kept between the edge of the scoop and a tab's icon. */
export const ICON_CLEARANCE = 16;

/** The smallest the scoop is allowed to become on a very narrow screen. */
export const MIN_NOTCH_HALF_WIDTH = 40;

export interface NotchGeometry {
  /** x of the notch's centre — always the middle of the bar. */
  centre: number;
  /** Half the scoop's width at the top edge, after clamping. */
  half: number;
}

/**
 * The notch, sized for this screen.
 *
 * The half-width is clamped so the scoop can never reach a tab's icon: the
 * nearest icon centre is half a slot from the middle, so the scoop is kept
 * `ICON_CLEARANCE` clear of it. On a narrow phone the notch simply becomes a
 * little tighter rather than cutting into the tabs.
 */
export function notchGeometry(barWidth: number, tabWidth: number): NotchGeometry {
  const safeHalf = Math.max(tabWidth / 2 - ICON_CLEARANCE, MIN_NOTCH_HALF_WIDTH);
  return { centre: barWidth / 2, half: Math.min(NOTCH_HALF_WIDTH, safeHalf) };
}

/** One axis of a cubic Bézier at t. */
function cubic(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * How deep the scoop is at horizontal position `x`.
 *
 * 0 outside the notch, `NOTCH_DEPTH` at the centre. Solved by sampling the
 * curve rather than inverting it: the Bézier is monotonic in x across each
 * half, so walking t and taking the nearest sample is both correct and more
 * readable than a closed-form root.
 *
 * This is what lets a test assert that the icons are clear of the curve.
 */
export function notchDepthAt(x: number, geometry: NotchGeometry): number {
  const { centre, half } = geometry;
  const distance = Math.abs(x - centre);
  if (distance >= half) return 0;

  const shoulder = half * NOTCH_SHOULDER;
  // The left half, mirrored — the two sides are symmetrical by construction.
  const from = centre - half;
  const target = centre - distance;

  let best = 0;
  let bestError = Infinity;
  const STEPS = 240;
  for (let i = 0; i <= STEPS; i += 1) {
    const t = i / STEPS;
    const px = cubic(t, from, from + shoulder, centre - shoulder, centre);
    const error = Math.abs(px - target);
    if (error < bestError) {
      bestError = error;
      best = cubic(t, 0, 0, NOTCH_DEPTH, NOTCH_DEPTH);
    }
  }
  return best;
}

/**
 * The bar's outline: rounded top corners, a scoop in the middle, square at
 * the bottom so it sits flush with the screen edge.
 *
 * Two cubic curves make the scoop — one down into it, one back out — with
 * their control points mirrored about the centre, which is what keeps the two
 * sides symmetrical and the joins smooth.
 */
export function buildBarPath(
  width: number,
  height: number,
  centre: number,
  half: number
): string {
  const shoulder = half * NOTCH_SHOULDER;
  const left = centre - half;
  const right = centre + half;

  return [
    `M 0 ${BAR_RADIUS}`,
    `Q 0 0 ${BAR_RADIUS} 0`,
    `L ${left} 0`,
    // Down into the scoop: flat at the lip, steepest in the middle.
    `C ${left + shoulder} 0 ${centre - shoulder} ${NOTCH_DEPTH} ${centre} ${NOTCH_DEPTH}`,
    // And back out, mirrored.
    `C ${centre + shoulder} ${NOTCH_DEPTH} ${right - shoulder} 0 ${right} 0`,
    `L ${width - BAR_RADIUS} 0`,
    `Q ${width} 0 ${width} ${BAR_RADIUS}`,
    `L ${width} ${height}`,
    `L 0 ${height}`,
    'Z',
  ].join(' ');
}
