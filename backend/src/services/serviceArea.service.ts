import boundary from '../data/ratnagiri-district.json';
import { logger } from '../utils/logger';

/**
 * Service-area validation.
 *
 * Swachham operates in Ratnagiri district. Whether a coordinate qualifies is
 * decided here, on the server, by testing it against the district's actual
 * administrative boundary — a MultiPolygon from OpenStreetMap, not a radius
 * around Ratnagiri city. A radius would wrongly exclude Chiplun, Khed,
 * Rajapur and everyone else in the district's ~150 km spread.
 *
 * Nothing the client says about its district is trusted or even read: the
 * answer is computed from latitude and longitude alone.
 */

export const SERVICE_DISTRICT = boundary.district;

export const OUTSIDE_MESSAGE =
  `Swachham is currently available only in ${boundary.district} district.`;

/**
 * How far outside the boundary still counts as inside.
 *
 * A consumer GPS fix is routinely 10–50 m out and can be far worse indoors or
 * under cloud, and the boundary itself is a simplified survey line. Someone
 * genuinely standing in a border village must not be refused because their
 * fix landed on the wrong side of it, so a fixed margin is allowed, extended
 * by the device's own reported accuracy up to a ceiling.
 *
 * The ceiling matters: without one, a client could claim a 500 km accuracy
 * and buy itself an arbitrarily large buffer.
 */
const BASE_TOLERANCE_M = 1500;
const MAX_TOLERANCE_M = 5000;

/** Anything looser than this is not a usable fix for a yes/no decision. */
const UNUSABLE_ACCURACY_M = 20000;

export interface ServiceAreaResult {
  allowed: boolean;
  district: string;
  message?: string;
  /** True when the point fell outside but inside the tolerance margin. */
  nearBoundary?: boolean;
  /** Metres from the boundary; 0 when comfortably inside. */
  distanceM?: number;
}

/** Rejects anything that is not a real, finite WGS84 coordinate. */
export function isValidCoordinate(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    // 0,0 is in the Atlantic and is what a broken client sends.
    !(lat === 0 && lon === 0)
  );
}

/**
 * Ray casting against one ring.
 *
 * Counts how many times a ray cast east from the point crosses the ring's
 * edges; an odd count means inside. Works for concave shapes, which a real
 * district boundary very much is.
 */
function pointInRing(lat: number, lon: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lonI, latI] = ring[i];
    const [lonJ, latJ] = ring[j];
    const straddles = latI > lat !== latJ > lat;
    if (straddles) {
      const crossLon = ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI;
      if (lon < crossLon) inside = !inside;
    }
  }
  return inside;
}

/**
 * True when the point is inside the district.
 *
 * Each polygon's first ring is its outer boundary and any further rings are
 * holes, so a point inside a hole is outside the district.
 */
function pointInDistrict(lat: number, lon: number): boolean {
  for (const polygon of boundary.polygons) {
    const [outer, ...holes] = polygon;
    if (!pointInRing(lat, lon, outer)) continue;
    if (holes.some((hole) => pointInRing(lat, lon, hole))) continue;
    return true;
  }
  return false;
}

/** Metres per degree, near enough at Ratnagiri's latitude. */
const M_PER_DEG_LAT = 111_320;
function metresPerDegLon(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Shortest distance in metres from a point to a line segment. */
function distanceToSegment(
  lat: number,
  lon: number,
  aLon: number,
  aLat: number,
  bLon: number,
  bLat: number
): number {
  // Project to metres so the comparison is not distorted by longitude
  // degrees being shorter than latitude degrees.
  const mx = metresPerDegLon(lat);
  const px = (lon - aLon) * mx;
  const py = (lat - aLat) * M_PER_DEG_LAT;
  const vx = (bLon - aLon) * mx;
  const vy = (bLat - aLat) * M_PER_DEG_LAT;

  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) return Math.hypot(px, py);

  let t = (px * vx + py * vy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - t * vx, py - t * vy);
}

/** Shortest distance in metres from the point to the district boundary. */
function distanceToBoundary(lat: number, lon: number): number {
  let best = Infinity;
  for (const polygon of boundary.polygons) {
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const d = distanceToSegment(lat, lon, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
        if (d < best) best = d;
        // Nothing closer than this will change the outcome.
        if (best === 0) return 0;
      }
    }
  }
  return best;
}

/**
 * The service-area decision for one coordinate.
 *
 * `accuracyM`, when the device reports it, widens the boundary tolerance —
 * but only up to MAX_TOLERANCE_M, so it cannot be used to talk the check into
 * accepting a point hundreds of kilometres away.
 */
export function checkServiceArea(
  lat: number,
  lon: number,
  accuracyM?: number
): ServiceAreaResult {
  if (!isValidCoordinate(lat, lon)) {
    return {
      allowed: false,
      district: 'Unknown',
      message: 'A valid latitude and longitude are required.',
    };
  }

  // A fix this vague cannot answer the question either way; asking again is
  // better than guessing.
  if (typeof accuracyM === 'number' && accuracyM > UNUSABLE_ACCURACY_M) {
    return {
      allowed: false,
      district: 'Unknown',
      message:
        'Your location could not be pinned down accurately enough. Please move to an open area and try again.',
    };
  }

  if (pointInDistrict(lat, lon)) {
    return { allowed: true, district: SERVICE_DISTRICT, distanceM: 0 };
  }

  // Outside the line — but a near miss is treated as inside, because the
  // error is far more likely to be in the GPS fix than in the address.
  const tolerance = Math.min(
    BASE_TOLERANCE_M + Math.max(0, accuracyM || 0),
    MAX_TOLERANCE_M
  );

  // The bounding box makes the common far-away case cheap: no need to walk
  // 6,454 segments to tell someone in Mumbai they are out of area.
  const { minLat, maxLat, minLon, maxLon } = boundary.bbox;
  const padDeg = (MAX_TOLERANCE_M / M_PER_DEG_LAT) * 1.5;
  const farOutside =
    lat < minLat - padDeg ||
    lat > maxLat + padDeg ||
    lon < minLon - padDeg ||
    lon > maxLon + padDeg;

  if (!farOutside) {
    const distance = distanceToBoundary(lat, lon);
    if (distance <= tolerance) {
      logger.info(
        `[ServiceArea] ${lat},${lon} is ${Math.round(distance)}m outside — allowed within ${Math.round(tolerance)}m tolerance`
      );
      return {
        allowed: true,
        district: SERVICE_DISTRICT,
        nearBoundary: true,
        distanceM: Math.round(distance),
      };
    }
    return {
      allowed: false,
      district: 'Outside service area',
      message: OUTSIDE_MESSAGE,
      distanceM: Math.round(distance),
    };
  }

  return {
    allowed: false,
    district: 'Outside service area',
    message: OUTSIDE_MESSAGE,
  };
}

/** Metadata for the boundary in use, so its provenance is auditable. */
export function boundaryInfo() {
  return {
    district: boundary.district,
    state: boundary.state,
    source: boundary.source,
    bbox: boundary.bbox,
    points: boundary.polygons.flat(2).length,
  };
}
