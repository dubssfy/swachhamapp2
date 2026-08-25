/**
 * THE CURVED BOTTOM BAR, measured.
 *
 * Runs the app's OWN geometry — `mobile/src/components/tabBarNotch.ts`, the
 * same module LiquidGlassTabBar imports — across real device widths and
 * asserts the two properties that are easy to get wrong and impossible to
 * eyeball on one phone:
 *
 *   THE NOTCH MUST NOT REACH AN ICON. With four tabs the scoop is centred in
 *   the gap between tab 2 and tab 3, but a fixed-width scoop would still cut
 *   into them on a narrow screen.
 *
 *   THE SCOOP MUST STAY ABOVE THE ICON ROW. It cuts down from the top edge;
 *   the icons sit lower in the bar, and the clearance has to hold on every
 *   width rather than on the one the design was drawn at.
 *
 * Pure arithmetic — no database, no device.
 *
 *   npx ts-node --compiler-options '{"rootDir":"..","module":"commonjs"}' scripts/smoke_tab_bar_notch.ts
 */
import {
  notchGeometry,
  notchDepthAt,
  buildBarPath,
  NOTCH_DEPTH,
  MIN_NOTCH_HALF_WIDTH,
  ICON_CLEARANCE,
} from '../../mobile/src/components/tabBarNotch';

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** Real device widths, narrowest first. */
const WIDTHS: Array<[string, number]> = [
  ['iPhone SE', 320],
  ['Galaxy S8', 360],
  ['iPhone 13 mini', 375],
  ['Pixel 7', 412],
  ['iPhone 15 Pro Max', 430],
  ['small tablet', 600],
  ['iPad', 820],
  ['iPad Pro landscape', 1366],
];

const TABS = 4;

/**
 * The top of the icon row inside the bar.
 *
 * The tab is BAR_HEIGHT tall with its content centred; the icon plate is 40
 * high and the label sits under it, so the block is roughly 58 tall and its
 * top edge lands here. The scoop must not reach this deep at any icon's x.
 */
const BAR_HEIGHT = 94;
const ICON_BLOCK_HEIGHT = 58;
const ICON_TOP = (BAR_HEIGHT - ICON_BLOCK_HEIGHT) / 2;

console.log(`\nICON ROW STARTS AT y=${ICON_TOP}; SCOOP IS ${NOTCH_DEPTH} DEEP AT ITS CENTRE\n`);

for (const [name, width] of WIDTHS) {
  const tabWidth = width / TABS;
  const geometry = notchGeometry(width, tabWidth);
  const centre = width / 2;

  // Where each tab's icon sits.
  const iconCentres = Array.from({ length: TABS }, (_, i) => (i + 0.5) * tabWidth);
  const nearest = iconCentres.reduce((a, b) =>
    Math.abs(a - centre) < Math.abs(b - centre) ? a : b);

  const gap = Math.abs(nearest - centre) - geometry.half;
  check(
    `${name} (${width}px): the scoop stops short of the nearest icon`,
    gap >= 0,
    `half=${geometry.half.toFixed(1)}, nearest icon ${Math.abs(nearest - centre).toFixed(1)} away, gap ${gap.toFixed(1)}px`
  );

  // Depth directly above every icon must clear the icon row.
  const worst = Math.max(...iconCentres.map((x) => notchDepthAt(x, geometry)));
  check(
    `${name}: no icon is under the curve`,
    worst < ICON_TOP,
    `deepest above an icon: ${worst.toFixed(1)}px (icons start at ${ICON_TOP})`
  );

  // The notch stays a notch: never inverted, never wider than a tab gap.
  check(`${name}: the scoop has a sane width`,
    geometry.half >= MIN_NOTCH_HALF_WIDTH && geometry.half <= width / 2,
    `${(geometry.half * 2).toFixed(0)}px wide`);

  check(`${name}: the notch is centred`, Math.abs(geometry.centre - centre) < 0.001);
}

console.log('');

/* ---- The curve itself ---- */
const g = notchGeometry(412, 412 / 4);

check('the scoop is deepest exactly at the centre',
  Math.abs(notchDepthAt(g.centre, g) - NOTCH_DEPTH) < 0.5,
  `${notchDepthAt(g.centre, g).toFixed(2)} vs ${NOTCH_DEPTH}`);

check('it is flat outside the notch',
  notchDepthAt(g.centre - g.half - 1, g) === 0 &&
  notchDepthAt(g.centre + g.half + 1, g) === 0);

check('it is symmetrical about the centre',
  [10, 25, 40, 55].every((d) =>
    Math.abs(notchDepthAt(g.centre - d, g) - notchDepthAt(g.centre + d, g)) < 0.01));

check('it deepens monotonically towards the centre',
  (() => {
    let previous = -1;
    for (let d = g.half; d >= 0; d -= 2) {
      const depth = notchDepthAt(g.centre - d, g);
      if (depth < previous - 0.01) return false;
      previous = depth;
    }
    return true;
  })());

check('the lip meets the bar edge without a step',
  notchDepthAt(g.centre - g.half + 0.5, g) < 1.5,
  `${notchDepthAt(g.centre - g.half + 0.5, g).toFixed(2)}px at the lip`);

/* ---- The path is well-formed ---- */
const path = buildBarPath(412, 120, g.centre, g.half);
check('the path closes', path.trim().endsWith('Z'));
check('the path has both scoop curves', (path.match(/C /g) || []).length === 2);
check('the path has both rounded top corners', (path.match(/Q /g) || []).length === 2);
check('the path contains no NaN', !path.includes('NaN'));
check('the path spans the full width', path.includes('L 412 120') && path.includes('L 0 120'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
