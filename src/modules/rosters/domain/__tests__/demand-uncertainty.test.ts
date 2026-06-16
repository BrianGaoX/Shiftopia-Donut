/**
 * Unit tests for demand-uncertainty.ts (feature C2 — probabilistic demand).
 *
 * Pure, deterministic. Covers the probit/CDF/quantile primitives and the
 * service-level headcount engine across empirical, model, and no-buffer paths,
 * plus the backward-compatibility contract (SL <= 0.5 ⇒ no buffer).
 */
import { describe, it, expect } from 'vitest';
import {
  serviceLevelToZ,
  standardNormalCdf,
  empiricalQuantile,
  serviceLevelHeadcount,
  sigmaFromQuantiles,
  DEFAULT_SERVICE_LEVEL,
} from '../demand-uncertainty';

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

describe('serviceLevelToZ (inverse normal CDF)', () => {
  it('0.5 → 0', () => expect(serviceLevelToZ(0.5)).toBe(0));
  it('0.975 → ~1.96', () => expect(near(serviceLevelToZ(0.975), 1.95996, 1e-3)).toBe(true));
  it('0.84134 → ~1.0', () => expect(near(serviceLevelToZ(0.84134), 1.0, 1e-3)).toBe(true));
  it('0.9 → ~1.2816', () => expect(near(serviceLevelToZ(0.9), 1.28155, 1e-3)).toBe(true));
  it('is symmetric: z(0.1) = -z(0.9)', () =>
    expect(near(serviceLevelToZ(0.1), -serviceLevelToZ(0.9), 1e-6)).toBe(true));
  it('monotonic increasing', () =>
    expect(serviceLevelToZ(0.8) < serviceLevelToZ(0.95)).toBe(true));
});

describe('standardNormalCdf', () => {
  it('Φ(0) = 0.5', () => expect(near(standardNormalCdf(0), 0.5)).toBe(true));
  it('Φ(1.96) ≈ 0.975', () => expect(near(standardNormalCdf(1.96), 0.975)).toBe(true));
  it('Φ(-1) ≈ 0.1587', () => expect(near(standardNormalCdf(-1), 0.1587)).toBe(true));
  it('round-trips with the probit at 0.9', () =>
    expect(near(standardNormalCdf(serviceLevelToZ(0.9)), 0.9, 1e-3)).toBe(true));
});

describe('empiricalQuantile (type-7)', () => {
  it('median of [1,2,3] = 2', () => expect(empiricalQuantile([1, 2, 3], 0.5)).toBe(2));
  it('median of [1,2,3,4] = 2.5', () => expect(empiricalQuantile([1, 2, 3, 4], 0.5)).toBe(2.5));
  it('p=0 → min, p=1 → max', () => {
    expect(empiricalQuantile([5, 1, 9, 3], 0)).toBe(1);
    expect(empiricalQuantile([5, 1, 9, 3], 1)).toBe(9);
  });
  it('does not mutate input', () => {
    const xs = [3, 1, 2];
    empiricalQuantile(xs, 0.5);
    expect(xs).toEqual([3, 1, 2]);
  });
  it('single element', () => expect(empiricalQuantile([7], 0.9)).toBe(7));
  it('throws on empty', () => expect(() => empiricalQuantile([], 0.5)).toThrow());
});

describe('serviceLevelHeadcount — backward-compatibility (SL <= 0.5 = no buffer)', () => {
  it('default SL (0.5) on samples returns rounded median, zero buffer', () => {
    const r = serviceLevelHeadcount({ serviceLevel: DEFAULT_SERVICE_LEVEL, samples: [8, 8, 8, 11, 11] });
    expect(r.base).toBe(8); // median of [8,8,8,11,11] = 8
    expect(r.required).toBe(8);
    expect(r.buffer).toBe(0);
    expect(r.method).toBe('none');
  });

  it('SL 0.5 on a point estimate returns the rounded mean, zero buffer', () => {
    const r = serviceLevelHeadcount({ serviceLevel: 0.5, mean: 8 });
    expect(r.required).toBe(8);
    expect(r.buffer).toBe(0);
  });

  it('matches legacy Math.round(median) at SL 0.5 (even-count .5 rounds up)', () => {
    const r = serviceLevelHeadcount({ serviceLevel: 0.5, samples: [3, 4] });
    expect(r.base).toBe(4); // Math.round(3.5) === 4
    expect(r.required).toBe(4);
  });
});

describe('serviceLevelHeadcount — empirical path', () => {
  it('SL 0.9 staffs at/above the median and within the observed range', () => {
    const samples = [8, 8, 8, 8, 8, 11, 11, 11, 11, 11];
    const r = serviceLevelHeadcount({ serviceLevel: 0.9, samples });
    expect(r.method).toBe('empirical');
    expect(r.required).toBeGreaterThanOrEqual(r.base);
    expect(r.required).toBeLessThanOrEqual(Math.max(...samples));
    expect(r.buffer).toBeGreaterThanOrEqual(0);
    // coverageConfidence is the empirical fraction of observations covered
    expect(r.coverageConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('higher service level never reduces required headcount (monotonic)', () => {
    const samples = [4, 6, 6, 7, 9, 10, 12, 15];
    const r50 = serviceLevelHeadcount({ serviceLevel: 0.5, samples });
    const r80 = serviceLevelHeadcount({ serviceLevel: 0.8, samples });
    const r99 = serviceLevelHeadcount({ serviceLevel: 0.99, samples });
    expect(r80.required).toBeGreaterThanOrEqual(r50.required);
    expect(r99.required).toBeGreaterThanOrEqual(r80.required);
  });
});

describe('serviceLevelHeadcount — model path', () => {
  it('poisson buffer: SL 0.9, mean 8 → ~12 (8 + 1.28·√8)', () => {
    const r = serviceLevelHeadcount({ serviceLevel: 0.9, mean: 8, dispersion: 'poisson' });
    expect(r.method).toBe('poisson');
    expect(r.required).toBe(12); // ceil(8 + 1.2816*2.828) = ceil(11.62)
    expect(r.buffer).toBe(4);
    // ceil pushes confidence at or above the requested service level
    expect(r.coverageConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('normal buffer scales with cv: SL 0.975, mean 10, cv 0.3 → 16', () => {
    const r = serviceLevelHeadcount({ serviceLevel: 0.975, mean: 10, dispersion: 'normal', cv: 0.3 });
    expect(r.method).toBe('normal');
    expect(r.required).toBe(16); // ceil(10 + 1.96*3)
  });

  it("dispersion 'none' applies no buffer even above SL 0.5", () => {
    const r = serviceLevelHeadcount({ serviceLevel: 0.95, mean: 8, dispersion: 'none' });
    expect(r.required).toBe(8);
    expect(r.buffer).toBe(0);
  });

  it('zero mean → zero required (no spurious staffing)', () => {
    const r = serviceLevelHeadcount({ serviceLevel: 0.95, mean: 0, dispersion: 'poisson' });
    expect(r.required).toBe(0);
  });
});

describe('sigmaFromQuantiles + explicit-σ model path (ML quantile path)', () => {
  it('recovers σ from a normal P50/P90 pair', () => {
    // For N(10, 4): P50=10, P90 = 10 + 1.2816·4 = 15.126
    const sigma = sigmaFromQuantiles(10, 15.126, 0.5, 0.9);
    expect(near(sigma, 4, 0.05)).toBe(true);
  });

  it('degenerate inputs → σ = 0', () => {
    expect(sigmaFromQuantiles(10, 10, 0.5, 0.9)).toBe(0);
    expect(sigmaFromQuantiles(10, 20, 0.9, 0.5)).toBe(0); // upperQ <= lowerQ
  });

  it('explicit σ overrides the dispersion model', () => {
    // mean 10, σ 4, SL 0.9 → 10 + 1.2816·4 = 15.13 → ceil 16
    const r = serviceLevelHeadcount({ serviceLevel: 0.9, mean: 10, sigma: 4 });
    expect(r.method).toBe('normal');
    expect(r.required).toBe(16);
    // Differs from the Poisson assumption (σ=√10≈3.16 → 10+1.28·3.16≈14.05 → 15)
    const poisson = serviceLevelHeadcount({ serviceLevel: 0.9, mean: 10, dispersion: 'poisson' });
    expect(r.required).not.toBe(poisson.required);
  });

  it('end-to-end: quantiles → σ → service-level headcount', () => {
    const sigma = sigmaFromQuantiles(8, 12, 0.5, 0.9); // model says P50=8, P90=12
    const r = serviceLevelHeadcount({ serviceLevel: 0.95, mean: 8, sigma });
    expect(r.required).toBeGreaterThan(12); // 95% target exceeds the P90 point
    expect(r.coverageConfidence).toBeGreaterThanOrEqual(0.95);
  });
});

describe('serviceLevelHeadcount — floors & clamps', () => {
  it('minHeadcount floor raises the base', () => {
    const r = serviceLevelHeadcount({ serviceLevel: 0.5, mean: 2, minHeadcount: 5 });
    expect(r.base).toBe(5);
    expect(r.required).toBe(5);
  });

  it('service level is clamped to <= 0.999 (no infinite z)', () => {
    const r = serviceLevelHeadcount({ serviceLevel: 1.5, mean: 10, dispersion: 'poisson' });
    expect(Number.isFinite(r.required)).toBe(true);
    expect(r.serviceLevel).toBeLessThanOrEqual(0.999);
  });
});
