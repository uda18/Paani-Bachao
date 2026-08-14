const MAX_ROOF_AREA_M2 = 100000;

export function calculateRoofArea(lengthM: number, widthM: number): number | null {
  if (!Number.isFinite(lengthM) || !Number.isFinite(widthM)) return null;
  if (lengthM <= 0 || widthM <= 0) return null;
  const area = lengthM * widthM;
  if (!Number.isFinite(area) || area <= 0 || area > MAX_ROOF_AREA_M2) return null;
  return area;
}

export function roundForDisplay(area: number): number {
  return Math.round(area * 100) / 100;
}
