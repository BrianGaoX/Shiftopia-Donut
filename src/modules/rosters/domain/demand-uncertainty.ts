/**
 * Demand uncertainty & service-level buffering (feature C2).
 *
 * Problem: the demand pipeline collapses a distribution of expected demand to a
 * single point estimate — the per-cell MEDIAN (P50) in the rule/template path,
 * or the ML point prediction. Staffing to P50 means demand exceeds supply on
 * (roughly) half of comparable occasions → chronic under-staffing.
 *
 * This module converts a point or sampled demand estimate into a service-level
 * adjusted REQUIRED headcount: "staff so that demand ≤ scheduled with
 * probability `serviceLevel`". A 90% service level on a forecast of 8±3 covers
 * staffs ~10, not 8.
 *
 * Two estimation strategies:
 *   - EMPIRICAL — when historical samples are available (rule/template path):
 *     take the empirical quantile of the observed distribution. No distributional
 *     assumption; honours skew/bimodality in real demand.
 *   - MODEL — when only a point estimate is available (ML / rule baseline at
 *     runtime): assume a count distribution around the mean and staff at
 *     `mean + z(serviceLevel)·σ`, where
 *       * 'poisson' → σ = √mean         (default for integer count demand)
 *       * 'normal'  → σ = cv · mean     (cv = coefficient of variation)
 *
 * Backward-compatibility contract: `serviceLevel <= 0.5` produces NO buffer and
 * returns the rounded base (median/mean) exactly as the legacy code did. The
 * feature is therefore purely additive — callers opt in by raising the level.
 *
 * Pure, deterministic, dependency-free — fully unit-testable.
 */

export type DispersionModel = 'poisson' | 'normal' | 'none';

export interface ServiceLevelInput {
  /** Target P(scheduled >= demand), in (0,1). <= 0.5 means "no buffer". */
  serviceLevel: number;
  /** Point estimate of demand (model path). Used when `samples` is absent/empty. */
  mean?: number;
  /** Historical observations of demand for this cell (empirical path). */
  samples?: number[];
  /** Dispersion model for the point-estimate path. Default 'poisson'. */
  dispersion?: DispersionModel;
  /** Coefficient of variation for the 'normal' model. Default 0.5. */
  cv?: number;
  /**
   * Explicit standard deviation of demand around `mean`. When provided (and no
   * `samples`), it OVERRIDES the dispersion model — used by the ML path to feed
   * a model-derived σ (e.g. from predicted quantiles, see `sigmaFromQuantiles`)
   * instead of the Poisson approximation.
   */
  sigma?: number;
  /** Hard lower bound on the result (e.g. an L6 floor). Default 0. */
  minHeadcount?: number;
}

export interface ServiceLevelResult {
  /** The unbuffered point estimate (median of samples, or mean), rounded. */
  base: number;
  /** Service-level-adjusted required headcount (integer, never below base). */
  required: number;
  /** required − base (the staffing buffer added). Always >= 0. */
  buffer: number;
  /** Echoed, clamped service level actually applied. */
  serviceLevel: number;
  /** Modelled P(demand <= required): how confident this staffing is. */
  coverageConfidence: number;
  /** Which estimation path produced `required`. */
  method: 'empirical' | 'poisson' | 'normal' | 'none';
}

/** Default service level — 0.5 (median) preserves legacy behaviour. */
export const DEFAULT_SERVICE_LEVEL = 0.5;

/** Service levels below this are treated as "no buffer" (never de-staff below median). */
const NO_BUFFER_THRESHOLD = 0.5;
/** Clamp upper bound — beyond ~0.999 the z-score explodes for no practical gain. */
const MAX_SERVICE_LEVEL = 0.999;

const SQRT2 = Math.SQRT2;

/**
 * Inverse standard-normal CDF (probit). Acklam's rational approximation;
 * absolute error < 1.15e-9. Returns the z such that Φ(z) = p.
 */
export function serviceLevelToZ(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** error function — Abramowitz & Stegun 7.1.26, |error| < 1.5e-7. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** Standard-normal CDF Φ(z) = P(Z <= z). */
export function standardNormalCdf(z: number): number {
  return 0.5 * (1 + erf(z / SQRT2));
}

/**
 * Empirical quantile (type-7, linear interpolation between order statistics) —
 * the same definition used by NumPy/R defaults. `values` need not be sorted.
 */
export function empiricalQuantile(values: number[], p: number): number {
  if (values.length === 0) throw new Error('empiricalQuantile: empty input');
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.min(1, Math.max(0, p));
  const h = (sorted.length - 1) * clamped;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

function clampServiceLevel(sl: number): number {
  if (!Number.isFinite(sl)) return DEFAULT_SERVICE_LEVEL;
  return Math.min(MAX_SERVICE_LEVEL, Math.max(0, sl));
}

/**
 * Compute the service-level-adjusted required headcount for one demand cell.
 *
 * Picks the empirical path when `samples` is provided and non-empty; otherwise
 * the model path around `mean`. `serviceLevel <= 0.5` short-circuits to the
 * rounded base with a zero buffer (legacy behaviour). The result is never below
 * the rounded base or `minHeadcount`, so buffering can only ADD staff.
 */
export function serviceLevelHeadcount(input: ServiceLevelInput): ServiceLevelResult {
  const serviceLevel = clampServiceLevel(input.serviceLevel);
  const minHeadcount = Math.max(0, Math.floor(input.minHeadcount ?? 0));
  const hasSamples = Array.isArray(input.samples) && input.samples.length > 0;

  // ── Base point estimate ──────────────────────────────────────────────────
  const rawBase = hasSamples
    ? empiricalQuantile(input.samples!, 0.5) // median
    : Math.max(0, input.mean ?? 0);
  const base = Math.max(minHeadcount, Math.round(rawBase));

  // ── No-buffer fast path (default / de-staff guard) ─────────────────────────
  if (serviceLevel <= NO_BUFFER_THRESHOLD) {
    return {
      base,
      required: base,
      buffer: 0,
      serviceLevel,
      // Confidence that the median actually covers demand — informative even
      // when no buffer is applied.
      coverageConfidence: hasSamples
        ? fractionAtMost(input.samples!, base)
        : 0.5,
      method: 'none',
    };
  }

  // ── Empirical path ─────────────────────────────────────────────────────────
  if (hasSamples) {
    const q = empiricalQuantile(input.samples!, serviceLevel);
    const required = Math.max(base, minHeadcount, Math.ceil(q));
    return {
      base,
      required,
      buffer: required - base,
      serviceLevel,
      coverageConfidence: fractionAtMost(input.samples!, required),
      method: 'empirical',
    };
  }

  // ── Model path (point estimate + dispersion / explicit σ) ──────────────────
  const mean = Math.max(0, input.mean ?? 0);
  const dispersion: DispersionModel = input.dispersion ?? 'poisson';
  let sigma: number;
  let method: ServiceLevelResult['method'];
  if (input.sigma != null && Number.isFinite(input.sigma)) {
    // Caller-supplied σ (e.g. derived from ML-predicted quantiles) wins over
    // the assumed dispersion model — this is what replaces the Poisson
    // approximation once the model emits real uncertainty.
    sigma = Math.max(0, input.sigma);
    method = sigma > 0 ? 'normal' : 'none';
  } else if (dispersion === 'poisson') {
    sigma = Math.sqrt(mean);
    method = 'poisson';
  } else if (dispersion === 'normal') {
    sigma = Math.max(0, input.cv ?? 0.5) * mean;
    method = 'normal';
  } else {
    sigma = 0;
    method = 'none';
  }

  const z = serviceLevelToZ(serviceLevel);
  const requiredRaw = mean + z * sigma;
  const required = Math.max(base, minHeadcount, Math.ceil(requiredRaw - 1e-9));
  const coverageConfidence = sigma > 0
    ? standardNormalCdf((required - mean) / sigma)
    : 1;

  return { base, required, buffer: required - base, serviceLevel, coverageConfidence, method };
}

/**
 * Derive the standard deviation of demand from two predicted quantiles
 * (assuming local normality): σ = (upper − lower) / (z(upperQ) − z(lowerQ)).
 *
 * Lets the ML path turn a P50/P90 quantile pair into a σ that feeds
 * `serviceLevelHeadcount({ mean, sigma })`, so a single continuous service-level
 * slider works off discrete model quantiles — replacing the Poisson assumption
 * with model-measured uncertainty. Returns 0 if inputs are degenerate.
 */
export function sigmaFromQuantiles(
  lowerValue: number,
  upperValue: number,
  lowerQuantile = 0.5,
  upperQuantile = 0.9,
): number {
  if (!(upperQuantile > lowerQuantile)) return 0;
  const dz = serviceLevelToZ(upperQuantile) - serviceLevelToZ(lowerQuantile);
  if (!Number.isFinite(dz) || dz <= 0) return 0;
  return Math.max(0, (upperValue - lowerValue) / dz);
}

/** Fraction of samples <= x — the empirical P(demand <= x). */
function fractionAtMost(samples: number[], x: number): number {
  if (samples.length === 0) return 1;
  let count = 0;
  for (const v of samples) if (v <= x) count++;
  return count / samples.length;
}
