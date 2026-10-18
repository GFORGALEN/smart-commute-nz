/**
 * Counts the AT fare zones a bus or train journey travels through, from Auckland Transport's
 * published fare zone polygons (CC BY 4.0). AT charges by zones travelled through, not by the
 * number of vehicles: within one journey (transfers within 30 minutes, under four hours) every
 * zone touched counts once. An overlap area belongs to either neighbour, so the count is the
 * smallest set of zones that covers every part of the path.
 */
export interface FareZoneArea {
  /** One zone, or the two zones an overlap area belongs to. */
  zones: string[];
  /** [west, south, east, north] in degrees. */
  bbox: [number, number, number, number];
  /** Polygons of rings of [lng, lat]; the first ring is the outline, the rest are holes. */
  polygons: [number, number][][][];
}
export interface FareZoneMap {
  source: string;
  url: string;
  license: string;
  retrievedOn: string;
  sourceEditedOn: string;
  areas: FareZoneArea[];
}
export interface ZonePoint {
  lat: number;
  lng: number;
}
export interface ZonedRide {
  mode: 'bus' | 'train';
  /** The vehicle's path from boarding to alighting; the ends are where the rider tags. */
  path: ZonePoint[];
}
export interface ZoneCount {
  count: number;
  /** One smallest set of zones covering the journey, in the order it reaches them. */
  zones: string[];
}

let zoneMap: Promise<FareZoneMap> | undefined;
/** The zone data is loaded on first use, so planning without public transport never fetches it. */
export function loadATFareZones(): Promise<FareZoneMap> {
  zoneMap ??= import('./data/at-fare-zones.json').then(
    (module) => (module.default ?? module) as unknown as FareZoneMap,
  );
  return zoneMap;
}

function insideRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[previous]!;
    if (y1 > lat !== y2 > lat && lng < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/** The zones a point may be charged as: one, two inside an overlap area, or none offshore. */
export function zonesAt(map: FareZoneMap, point: ZonePoint): string[] {
  for (const area of map.areas) {
    const [west, south, east, north] = area.bbox;
    if (point.lng < west || point.lng > east || point.lat < south || point.lat > north) continue;
    const hit = area.polygons.some(
      ([outline, ...holes]) =>
        outline !== undefined &&
        insideRing(point.lng, point.lat, outline) &&
        !holes.some((hole) => insideRing(point.lng, point.lat, hole)),
    );
    if (hit) return area.zones;
  }
  return [];
}

const SAMPLE_METRES = 100;
/** Points along a path no more than about 100 m apart, so a narrow zone is not stepped over. */
function sample(path: ZonePoint[]): ZonePoint[] {
  const points: ZonePoint[] = [];
  path.forEach((point, index) => {
    const next = path[index + 1];
    points.push(point);
    if (!next) return;
    const metresPerDegree = 111_320;
    const dx = (next.lng - point.lng) * metresPerDegree * Math.cos((point.lat * Math.PI) / 180);
    const dy = (next.lat - point.lat) * metresPerDegree;
    const steps = Math.floor(Math.hypot(dx, dy) / SAMPLE_METRES);
    for (let step = 1; step <= steps; step += 1) {
      const share = step / (steps + 1);
      points.push({
        lat: point.lat + (next.lat - point.lat) * share,
        lng: point.lng + (next.lng - point.lng) * share,
      });
    }
  });
  return points;
}

/**
 * The zones one journey is charged for, or undefined when a ride has no path or no part of the
 * journey lies in a zone. AT does not charge for the City zone on a train passing through it
 * when the rider neither tags on nor off there, so those train points are left out.
 */
export function countJourneyZones(map: FareZoneMap, rides: ZonedRide[]): ZoneCount | undefined {
  if (!rides.length || rides.some((ride) => ride.path.length === 0)) return undefined;
  const tags = rides.flatMap((ride) => [ride.path[0]!, ride.path.at(-1)!]);
  // A tag in an overlap area such as Newmarket can count as the other zone, so only a tag wholly
  // inside City makes the City part of a train ride chargeable.
  const onlyCity = (zones: string[]) => zones.length === 1 && zones[0] === 'City';
  const tagsInCity = tags.some((point) => onlyCity(zonesAt(map, point)));
  const covers: string[][] = [];
  for (const ride of rides) {
    for (const point of sample(ride.path)) {
      const zones = zonesAt(map, point);
      if (!zones.length) continue;
      if (ride.mode === 'train' && !tagsInCity && onlyCity(zones)) continue;
      covers.push(zones);
    }
  }
  if (!covers.length) return undefined;
  // Each point needs one of its zones charged; with nine zones every subset can be tried.
  const candidates = [...new Set(covers.flat())];
  let best: string[] | undefined;
  for (let mask = 1; mask < 1 << candidates.length; mask += 1) {
    const chosen = candidates.filter((_, index) => mask & (1 << index));
    if (best && chosen.length >= best.length) continue;
    if (covers.every((zones) => zones.some((zone) => chosen.includes(zone)))) best = chosen;
  }
  if (!best) return undefined;
  const firstSeen = (zone: string) => covers.findIndex((zones) => zones.includes(zone));
  return { count: best.length, zones: best.sort((a, b) => firstSeen(a) - firstSeen(b)) };
}
