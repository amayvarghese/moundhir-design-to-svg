import { useCallback, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { GenerateMeta } from "../types";

interface SvgPreviewProps {
  svg: string;
  meta: GenerateMeta;
}

/**
 * Browsers treat width="1.5m" / height="3m" as real meters (~screen-sized),
 * which breaks the preview. Keep viewBox for aspect ratio and force fluid sizing.
 */
export function preparePreviewSvg(svg: string): string {
  let out = svg.trim();

  // Drop absolute physical width/height (m, mm, cm, in, px, bare numbers)
  out = out.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, "");

  // Ensure we can scale into the preview box
  if (!/\bpreserveAspectRatio\s*=/i.test(out)) {
    out = out.replace(
      /<svg\b/i,
      '<svg preserveAspectRatio="xMidYMid meet"',
    );
  }

  out = out.replace(
    /<svg\b/i,
    '<svg width="auto" height="100%" style="display:block;width:auto;height:100%;max-width:100%;max-height:100%"',
  );

  // Guarantee a viewBox so scaling works even if the model omitted it
  if (!/\bviewBox\s*=/i.test(out)) {
    out = out.replace(/<svg\b/i, '<svg viewBox="0 0 1500 3000"');
  }

  return out;
}

function parseAspectRatio(meta: GenerateMeta, svg: string): string {
  const vb =
    meta.viewBox ??
    svg.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1] ??
    "0 0 1500 3000";
  const parts = vb.trim().split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
    return `${parts[2]} / ${parts[3]}`;
  }
  if (meta.widthMeters && meta.heightMeters) {
    return `${meta.widthMeters} / ${meta.heightMeters}`;
  }
  return "1 / 2";
}

export function SvgPreview({ svg, meta }: SvgPreviewProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  const previewSvg = useMemo(() => preparePreviewSvg(svg), [svg]);
  const aspectRatio = useMemo(
    () => parseAspectRatio(meta, svg),
    [meta, svg],
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const dims =
    meta.physicalSize ??
    (meta.widthMeters != null && meta.heightMeters != null
      ? `${meta.widthMeters} m × ${meta.heightMeters} m`
      : meta.width && meta.height
        ? `${meta.width} × ${meta.height} mm`
        : meta.viewBox
          ? `viewBox ${meta.viewBox}`
          : "—");

  return (
    <section className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold text-ink">SVG Preview</h2>
          <p className="text-sm text-ink-soft/80">
            Pinch-friendly zoom · drag to pan
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-medium text-ink-soft">
          <MetaChip label="Size" value={dims} />
          <MetaChip
            label="Time"
            value={`${(meta.elapsedMs / 1000).toFixed(1)}s`}
          />
          {meta.retried && <MetaChip label="Retry" value="used" />}
        </div>
      </div>

      <div
        className="relative h-[min(62vh,560px)] touch-none overflow-hidden rounded-[1.5rem] border border-line/50 bg-[linear-gradient(45deg,#edf2f7_25%,transparent_25%),linear-gradient(-45deg,#edf2f7_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#edf2f7_75%),linear-gradient(-45deg,transparent_75%,#edf2f7_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0] bg-paper-bright shadow-[0_20px_50px_rgba(11,31,51,0.08)]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => {
          e.preventDefault();
          setScale((s) => Math.min(4, Math.max(0.4, s - e.deltaY * 0.0015)));
        }}
      >
        <motion.div
          className="flex h-full w-full items-center justify-center p-5"
          style={{
            x: offset.x,
            y: offset.y,
            scale,
          }}
        >
          <div
            className="flex h-full max-h-full w-full max-w-full items-center justify-center"
            style={{ containerType: "size" }}
          >
            <div
              className="max-h-full max-w-full"
              style={{
                aspectRatio,
                height: "100%",
                width: "auto",
                maxWidth: "100%",
              }}
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
          </div>
        </motion.div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ZoomButton label="−" onClick={() => setScale((s) => Math.max(0.4, s - 0.2))} />
        <ZoomButton label="+" onClick={() => setScale((s) => Math.min(4, s + 0.2))} />
        <button
          type="button"
          onClick={resetView}
          className="min-h-10 rounded-xl px-3 text-sm font-medium text-ink-soft hover:bg-paper-bright"
        >
          Reset view
        </button>
        <span className="ml-auto text-xs tabular-nums text-ink-soft/70">
          {Math.round(scale * 100)}%
        </span>
      </div>
    </section>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line/60 bg-paper-bright/80 px-3 py-1.5">
      <span className="uppercase tracking-wider text-[10px] text-ink-soft/60">
        {label}
      </span>
      <span className="text-ink">{value}</span>
    </span>
  );
}

function ZoomButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-paper-bright text-lg font-semibold text-ink"
      aria-label={label === "+" ? "Zoom in" : "Zoom out"}
    >
      {label}
    </button>
  );
}
