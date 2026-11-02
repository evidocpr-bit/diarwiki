import { describe, expect, it } from 'vitest';
import { mgdlToMmol, mmolToMgdl, roundResult } from '../../src/lib/glucose-units';

describe('glucose unit conversion', () => {
  it('converts mmol/L to mg/dL using glucose molar mass', () => {
    expect(roundResult(mmolToMgdl(5.6), 'mmol-to-mgdl')).toBe(101);
  });

  it('converts mg/dL to mmol/L and rounds to one decimal', () => {
    expect(roundResult(mgdlToMmol(100), 'mgdl-to-mmol')).toBe(5.5);
  });

  it('keeps both directions mathematically reversible before display rounding', () => {
    expect(mgdlToMmol(mmolToMgdl(7.2))).toBeCloseTo(7.2, 10);
  });
});
