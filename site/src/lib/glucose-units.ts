export const MGDL_PER_MMOLL = 18.0182;

export function mmolToMgdl(value: number): number {
  return value * MGDL_PER_MMOLL;
}

export function mgdlToMmol(value: number): number {
  return value / MGDL_PER_MMOLL;
}

export function roundResult(value: number, direction: 'mmol-to-mgdl' | 'mgdl-to-mmol'): number {
  return direction === 'mmol-to-mgdl' ? Math.round(value) : Math.round(value * 10) / 10;
}
