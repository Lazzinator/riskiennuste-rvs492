// Deterministinen satunnaislukugeneraattori (mulberry32) ja jakaumat.
// Sama siemenluku tuottaa aina saman datan.

export interface Rng {
  /** Tasajakauma [0, 1) */
  next(): number;
  normal(mean?: number, sd?: number): number;
  poisson(lambda: number): number;
  /** Indeksi painojen mukaan. */
  weighted(weights: readonly number[]): number;
  int(minIncl: number, maxIncl: number): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let spare: number | null = null;
  const normal = (mean = 0, sd = 1): number => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return mean + sd * v;
    }
    // Box-Muller
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return mean + sd * r * Math.cos(2 * Math.PI * v);
  };

  const poisson = (lambda: number): number => {
    if (lambda <= 0) return 0;
    // Knuthin menetelmä riittää, koska tunti- ja päivätason intensiteetit ovat pieniä.
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = next();
    while (p > limit) {
      k++;
      p *= next();
    }
    return k;
  };

  const weighted = (weights: readonly number[]): number => {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) throw new Error('painojen summa on nolla');
    let r = next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  };

  const int = (minIncl: number, maxIncl: number): number =>
    minIncl + Math.floor(next() * (maxIncl - minIncl + 1));

  return { next, normal, poisson, weighted, int };
}
