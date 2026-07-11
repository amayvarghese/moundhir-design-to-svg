import { motion } from "framer-motion";

interface ImagePreviewProps {
  src: string;
  onRetake: () => void;
  onGenerate: () => void;
  generating?: boolean;
}

export function ImagePreview({
  src,
  onRetake,
  onGenerate,
  generating,
}: ImagePreviewProps) {
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
