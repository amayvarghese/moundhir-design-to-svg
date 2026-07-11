/** Physical output canvas: 1.5 m wide × 3 m tall (user units = millimeters). */
export const TARGET_CANVAS = {
  widthMeters: 1.5,
  heightMeters: 3,
  widthMm: 1500,
  heightMm: 3000,
  widthAttr: "1.5m",
  heightAttr: "3m",
  viewBox: "0 0 1500 3000",
  /** Margin inside the canvas when fitting artwork (fraction of each side). */
  paddingRatio: 0.04,
} as const;

export function formatPhysicalSize(): string {
  return `${TARGET_CANVAS.widthMeters} m × ${TARGET_CANVAS.heightMeters} m`;
}
