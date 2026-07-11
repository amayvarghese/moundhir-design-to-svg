export type FacingMode = "user" | "environment";

export type AppPhase =
  | "camera"
  | "preview"
  | "generating"
  | "result"
  | "denied";

export interface GenerateMeta {
  elapsedMs: number;
  retried: boolean;
  model: string;
  width: number | null;
  height: number | null;
  widthMeters?: number;
  heightMeters?: number;
  physicalSize?: string;
  unit?: "m";
  viewBox: string | null;
  preprocess?: {
    width: number;
    height: number;
  };
}

export interface GenerateSvgResponse {
  svg: string;
  meta: GenerateMeta;
}

export interface StoredSvg {
  svg: string;
  meta: GenerateMeta;
  savedAt: string;
  sourceImage?: string;
}
