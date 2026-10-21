import { describe, expect, it } from 'vitest';
import { createRng } from '../src/data/rng';

describe('createRng', () => {
  it('tuottaa saman jonon samalla siemenellä', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('tuottaa eri jonon eri siemenellä', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect([a.next(), a.next()]).not.toEqual([b.next(), b.next()]);
  });

  it('pysyy välillä [0, 1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('Poisson-jakauman keskiarvo vastaa parametria', () => {
    const r = createRng(3);
    let sum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) sum += r.poisson(2.5);
    expect(sum / n).toBeCloseTo(2.5, 1);
    expect(r.poisson(0)).toBe(0);
  });

  it('normaalijakauman keskiarvo ja hajonta ovat oikein', () => {
    const r = createRng(4);
    const xs = Array.from({ length: 20_000 }, () => r.normal(5, 2));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(mean).toBeCloseTo(5, 1);
    expect(sd).toBeCloseTo(2, 1);
  });

  it('painotettu valinta noudattaa painoja eikä valitse nollapainoa', () => {
    const r = createRng(5);
    const counts = [0, 0, 0];
    for (let i = 0; i < 10_000; i++) counts[r.weighted([1, 0, 3])]!++;
    expect(counts[1]).toBe(0);
    expect(counts[2]! / counts[0]!).toBeGreaterThan(2.6);
    expect(counts[2]! / counts[0]!).toBeLessThan(3.4);
    expect(() => r.weighted([0, 0])).toThrow();
  });
});
