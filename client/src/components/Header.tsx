import { motion } from "framer-motion";

export function Header() {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-end justify-between gap-4 px-4 pt-6 sm:px-6">
      <div>
        <motion.p
          className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-accent-deep"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          Live sketch capture
        </motion.p>
        <motion.h1
          className="font-display text-4xl font-extrabold leading-none tracking-tight text-ink sm:text-5xl"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
        >
          Sketch2SVG
          <span className="block text-[0.55em] font-bold tracking-wide text-ink-soft/80">
            Camera
          </span>
        </motion.h1>
      </div>
      <motion.div
        className="hidden rounded-full border border-line/60 bg-paper-bright/70 px-3 py-1.5 text-xs font-medium text-ink-soft backdrop-blur sm:block"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        Point · Capture · Vectorize
      </motion.div>
    </header>
  );
}
