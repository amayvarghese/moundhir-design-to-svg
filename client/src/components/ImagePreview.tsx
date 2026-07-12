import { motion } from "framer-motion";
import type { TraceMode } from "../types";

interface ImagePreviewProps {
  src: string;
  onRetake: () => void;
  onGenerate: () => void;
  generating?: boolean;
  mode: TraceMode;
  onModeChange: (mode: TraceMode) => void;
}

const MODES: { value: TraceMode; label: string; hint: string }[] = [
  { value: "ai", label: "AI clean", hint: "Redraw as clean, professional shapes (Groq)" },
  { value: "technical", label: "Trace", hint: "Exact geometry traced from the drawing" },
  { value: "line", label: "Line art", hint: "Trace dark pen/pencil strokes" },
  { value: "edge", label: "Outlines", hint: "Trace object edges (photos, 3D)" },
];

export function ImagePreview({
  src,
  onRetake,
  onGenerate,
  generating,
  mode,
  onModeChange,
}: ImagePreviewProps) {
  const activeHint = MODES.find((m) => m.value === mode)?.hint ?? "";
  return (
    <motion.section
      className="mx-auto w-full max-w-5xl px-4 sm:px-6"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold text-ink">Preview</h2>
          <p className="text-sm text-ink-soft/80">
            Cropped and centered for cleaner vectorization.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.5rem] border border-line/50 bg-paper-bright shadow-[0_20px_50px_rgba(11,31,51,0.08)]">
        <img
          src={src}
          alt="Captured sketch preview"
          className="mx-auto max-h-[min(58vh,520px)] w-full object-contain bg-[radial-gradient(circle_at_center,#fff_0%,#f0f5fa_100%)]"
        />
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft/60">
          Drawing style
        </p>
        <div
          role="group"
          aria-label="Drawing style"
          className="flex flex-wrap gap-1.5 rounded-2xl border border-line/60 bg-paper-bright p-1.5"
        >
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => onModeChange(m.value)}
              disabled={generating}
              aria-pressed={mode === m.value}
              title={m.hint}
              className={`min-h-10 flex-1 rounded-xl px-3 text-sm font-semibold transition disabled:opacity-50 ${
                mode === m.value
                  ? "bg-ink text-paper shadow-[0_8px_20px_rgba(11,31,51,0.22)]"
                  : "text-ink-soft hover:bg-line/30"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-ink-soft/70">{activeHint}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onRetake}
          disabled={generating}
          className="min-h-12 flex-1 rounded-2xl border border-line bg-paper-bright px-5 text-sm font-semibold text-ink-soft transition hover:border-ink/20 disabled:opacity-50 sm:flex-none"
        >
          Retake
        </button>
        <motion.button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          whileTap={{ scale: 0.98 }}
          className="min-h-12 flex-[2] rounded-2xl bg-ink px-5 text-sm font-semibold text-paper shadow-[0_12px_28px_rgba(11,31,51,0.25)] transition hover:bg-ink-soft disabled:opacity-50 sm:flex-none sm:min-w-[200px]"
        >
          {generating ? "Generating…" : "Generate SVG"}
        </motion.button>
      </div>
    </motion.section>
  );
}
