import { describe, expect, it } from 'vitest';
import {
  AREA_CENTER,
  AREA_POLYGON,
  SETTLEMENTS,
  buildGrid,
  cellFeatures,
  distanceM,
  distanceToPolylineM,
  pointInPolygon,
  spatialWeight,
} from '../src/data/geo';

describe('geometria', () => {
  it('laskee etäisyydet metreinä', () => {
    // Yksi leveysaste on noin 111 km.
    expect(distanceM([60, 23], [61, 23])).toBeCloseTo(111_320, -2);
    // Inkere ja Kaivola ovat noin 2 km päässä toisistaan.
    const [inkere, kaivola] = SETTLEMENTS;
    const d = distanceM(inkere!.center, kaivola!.center);
    expect(d).toBeGreaterThan(1500);
    expect(d).toBeLessThan(2500);
  });

  it('laskee etäisyyden murtoviivaan', () => {
    const line = [
      [60.4, 23.2],
      [60.4, 23.3],
    ] as const;
    expect(distanceToPolylineM([60.4, 23.25], line)).toBeCloseTo(0, 3);
    expect(distanceToPolylineM([60.41, 23.25], line)).toBeCloseTo(1113, -1);
  });

  it('keskipiste ja taajamat ovat alueen sisällä', () => {
    expect(pointInPolygon(AREA_CENTER, AREA_POLYGON)).toBe(true);
    for (const s of SETTLEMENTS) expect(pointInPolygon(s.center, AREA_POLYGON)).toBe(true);
    // Salon keskusta (noin 60.385 N, 23.125 E) ei kuulu Perttelin alueeseen.
    expect(pointInPolygon([60.385, 23.125], AREA_POLYGON)).toBe(false);
  });
});

describe('ruudukko', () => {
  const grid = buildGrid(1000);

  it('kattaa Perttelin kokoisen alueen 1 km ruuduilla', () => {
    // Entinen Perttelin kunta on noin 270 km², karkea rajaus on hieman suurempi.
    expect(grid.cells.length).toBeGreaterThan(220);
    expect(grid.cells.length).toBeLessThan(400);
    expect(new Set(grid.cells.map((c) => c.id)).size).toBe(grid.cells.length);
  });

  it('ruudut ovat noin 1 km x 1 km', () => {
    for (const c of grid.cells.slice(0, 20)) {
      expect(distanceM([c.south, c.west], [c.north, c.west])).toBeCloseTo(1000, -1);
      expect(distanceM([c.south, c.west], [c.south, c.east])).toBeCloseTo(1000, -1);
    }
  });

  it('painottaa liikenneonnettomuudet teille ja maastopalot metsiin', () => {
    const scored = grid.cells.map((c) => ({ c, f: cellFeatures(c) }));
    const nearInkere = scored.reduce((a, b) =>
      distanceM([a.c.centerLat, a.c.centerLon], SETTLEMENTS[0]!.center) <
      distanceM([b.c.centerLat, b.c.centerLon], SETTLEMENTS[0]!.center)
        ? a
        : b,
    );
    const northernmost = scored.reduce((a, b) => (a.c.centerLat > b.c.centerLat ? a : b));
    expect(nearInkere.f.settlement).toBeGreaterThan(0.8);
    expect(spatialWeight('tarkastustehtava', nearInkere.f)).toBeGreaterThan(
      10 * spatialWeight('tarkastustehtava', northernmost.f),
    );

    const roadCells = scored.filter((s) => s.f.majorRoad > 0.5);
    const offRoad = scored.filter((s) => s.f.majorRoad < 0.05 && s.f.minorRoad < 0.05);
    expect(roadCells.length).toBeGreaterThan(10);
    const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(roadCells.map((s) => spatialWeight('liikenneonnettomuus', s.f)))).toBeGreaterThan(
      10 * mean(offRoad.map((s) => spatialWeight('liikenneonnettomuus', s.f))),
    );
    expect(mean(offRoad.map((s) => s.f.forest))).toBeGreaterThan(mean(roadCells.map((s) => s.f.forest)));
  });
});
