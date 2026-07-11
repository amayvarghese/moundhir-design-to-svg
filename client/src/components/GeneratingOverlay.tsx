import { motion } from "framer-motion";

export function GeneratingOverlay() {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 px-6 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm rounded-[1.75rem] bg-paper-bright p-8 text-center shadow-2xl">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center">
          <motion.div
            className="absolute h-16 w-16 rounded-full border-2 border-accent/30"
            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.15, 0.5] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            animate={{ rotate: 360 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
          >
            <path
              d="M20 4c8.8 0 16 7.2 16 16"
              stroke="#00B4A0"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="20" cy="20" r="3" fill="#0B1F33" />
          </motion.svg>
        </div>
        <h3 className="font-display text-xl font-bold text-ink">
          Tracing your sketch
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft/80">
          Vision model is converting line art into clean SVG primitives…
        </p>
        <div className="mt-6 flex justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-accent"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
              transition={{
                duration: 0.9,
                repeat: Infinity,
                delay: i * 0.15,
              }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
