import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface SvgCodeProps {
  svg: string;
  onCopy: () => void;
}

export function SvgCode({ svg, onCopy }: SvgCodeProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl border border-line/60 bg-paper-bright/70 px-4 py-3 text-left backdrop-blur"
      >
        <span className="font-display text-lg font-bold text-ink">SVG Code</span>
        <span className="text-sm text-ink-soft">{open ? "Hide" : "Show"}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mt-3 overflow-hidden rounded-2xl border border-line/50 bg-ink">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
                <span className="font-mono text-xs text-glow/80">
                  sketch.svg · {svg.length.toLocaleString()} chars
                </span>
                <button
                  type="button"
                  onClick={onCopy}
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-paper hover:bg-white/15"
                >
                  Copy
                </button>
              </div>
              <pre className="max-h-64 overflow-auto p-4 font-mono text-xs leading-relaxed text-glow/90">
                {svg}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
