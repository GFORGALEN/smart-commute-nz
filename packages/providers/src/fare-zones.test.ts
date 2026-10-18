import { describe, expect, it } from 'vitest';
import { countJourneyZones, loadATFareZones, zonesAt, type ZonePoint } from './fare-zones';

const at = (lat: number, lng: number): ZonePoint => ({ lat, lng });
const stations = {
  henderson: at(-36.8812, 174.631),
  glenEden: at(-36.911, 174.6527),
  newLynn: at(-36.908, 174.6855),
  avondale: at(-36.897, 174.699),
  mtAlbert: at(-36.8856, 174.7187),
  kingsland: at(-36.8724, 174.7444),
  mtEden: at(-36.8671, 174.7564),
  grafton: at(-36.8668, 174.7663),
  newmarket: at(-36.8698, 174.7781),
  britomart: at(-36.8443, 174.7678),
  onehunga: at(-36.9238, 174.786),
  epsom: at(-36.889, 174.771),
};

describe('AT fare zones from the published polygons', () => {
  it('places stations in their zone or overlap area', async () => {
    const map = await loadATFareZones();
    expect(map.license).toBe('CC BY 4.0');
    expect(zonesAt(map, stations.britomart)).toEqual(['City']);
    expect(zonesAt(map, stations.newmarket)).toEqual(['City', 'Isthmus']);
    expect(zonesAt(map, stations.onehunga)).toEqual(['Isthmus', 'Northern Manukau']);
    expect(zonesAt(map, stations.henderson)).toEqual(['Waitākere']);
  });

  it("matches AT's examples: Henderson to Britomart is 3 zones, Onehunga to Epsom is 1", async () => {
    const map = await loadATFareZones();
    const western = [
      stations.henderson,
      stations.glenEden,
      stations.newLynn,
      stations.avondale,
      stations.mtAlbert,
      stations.kingsland,
      stations.mtEden,
      stations.grafton,
      stations.britomart,
    ];
    expect(countJourneyZones(map, [{ mode: 'train', path: western }])).toEqual({
      count: 3,
      zones: ['Waitākere', 'Isthmus', 'City'],
    });
    expect(
      countJourneyZones(map, [{ mode: 'bus', path: [stations.onehunga, stations.epsom] }]),
    ).toEqual({ count: 1, zones: ['Isthmus'] });
  });

  it('charges an overlap area as whichever zone keeps the count lowest', async () => {
    const map = await loadATFareZones();
    expect(
      countJourneyZones(map, [{ mode: 'bus', path: [stations.britomart, stations.newmarket] }]),
    ).toEqual({ count: 1, zones: ['City'] });
  });

  it('skips the City zone for a train passing through it without a tag there', async () => {
    const map = await loadATFareZones();
    const viaGrafton = [stations.mtAlbert, stations.kingsland, stations.mtEden, stations.grafton];
    const train = [...viaGrafton, stations.newmarket];
    expect(countJourneyZones(map, [{ mode: 'train', path: train }])).toEqual({
      count: 1,
      zones: ['Isthmus'],
    });
    // The same path by bus is charged for City, and so is a train that stops there.
    expect(countJourneyZones(map, [{ mode: 'bus', path: train }])?.count).toBe(2);
    expect(countJourneyZones(map, [{ mode: 'train', path: viaGrafton }])?.count).toBe(2);
  });

  it('counts a transfer journey once per zone, however many vehicles it uses', async () => {
    const map = await loadATFareZones();
    const rides = [
      { mode: 'bus' as const, path: [stations.epsom, stations.newmarket] },
      { mode: 'bus' as const, path: [stations.newmarket, stations.epsom] },
    ];
    expect(countJourneyZones(map, rides)?.count).toBe(1);
  });

  it('gives no count without a path or with nothing inside a zone', async () => {
    const map = await loadATFareZones();
    expect(countJourneyZones(map, [{ mode: 'bus', path: [] }])).toBeUndefined();
    expect(
      countJourneyZones(map, [{ mode: 'bus', path: [at(-40, 170), at(-40.01, 170.01)] }]),
    ).toBeUndefined();
  });
});
