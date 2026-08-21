/**
 * Answers the service-area question for any coordinate, straight from the
 * district polygon. No server and no login needed — it runs the same code the
 * API and the order gate use.
 *
 * Usage:
 *   npm run check:area -- 16.9903 73.3118
 *   npm run check:area -- 16.9903 73.3118 45      (with GPS accuracy in metres)
 *   npm run check:area                            (runs a sample of known towns)
 */
require('ts-node').register({ transpileOnly: true });
const { checkServiceArea, boundaryInfo } = require('../src/services/serviceArea.service');

const SAMPLES = [
  ['Ratnagiri city', 16.9903, 73.3118],
  ['Chiplun', 17.53, 73.51],
  ['Khed', 17.718, 73.396],
  ['Dapoli', 17.759, 73.189],
  ['Guhagar', 17.48, 73.19],
  ['Rajapur', 16.66, 73.517],
  ['Lanja', 16.86, 73.55],
  ['Kolhapur (outside)', 16.705, 74.2433],
  ['Kudal / Sindhudurg (outside)', 16.01, 73.69],
  ['Mahad / Raigad (outside)', 18.08, 73.42],
  ['Mumbai (outside)', 19.076, 72.8777],
  ['Pune (outside)', 18.5204, 73.8567],
];

function report(label, lat, lon, accuracy) {
  const r = checkServiceArea(lat, lon, accuracy);
  const verdict = r.allowed ? 'ALLOWED' : 'BLOCKED';
  const extra = [
    r.district,
    r.distanceM !== undefined ? `${r.distanceM}m from boundary` : null,
    r.nearBoundary ? 'within GPS tolerance' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  console.log(`${verdict.padEnd(8)} ${label.padEnd(30)} ${lat}, ${lon}   ${extra}`);
  if (!r.allowed && r.message) console.log(`         ${r.message}`);
}

const [latArg, lonArg, accArg] = process.argv.slice(2);

const info = boundaryInfo();
console.log(`Boundary: ${info.district}, ${info.state} — ${info.points} points (${info.source.osm})`);
console.log(`bbox lat ${info.bbox.minLat}..${info.bbox.maxLat}  lon ${info.bbox.minLon}..${info.bbox.maxLon}\n`);

if (latArg && lonArg) {
  const lat = Number(latArg);
  const lon = Number(lonArg);
  const acc = accArg === undefined ? undefined : Number(accArg);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    console.error('Usage: npm run check:area -- <latitude> <longitude> [accuracyMetres]');
    process.exit(1);
  }
  report('your coordinate', lat, lon, acc);
} else {
  for (const [name, lat, lon] of SAMPLES) report(name, lat, lon, 30);
}
