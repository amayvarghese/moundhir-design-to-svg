import { motion } from "framer-motion";

interface ResultActionsProps {
  onDownloadSvg: () => void;
  onDownloadPng: () => void;
  onCopy: () => void;
  onRetake: () => void;
}

export function ResultActions({
  onDownloadSvg,
  onDownloadPng,
  onCopy,
  onRetake,
}: ResultActionsProps) {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
      <div className="flex flex-wrap gap-3">
        <PrimaryButton onClick={onDownloadSvg}>Download SVG</PrimaryButton>
        <SecondaryButton onClick={onDownloadPng}>Download PNG</SecondaryButton>
        <SecondaryButton onClick={onCopy}>Copy SVG</SecondaryButton>
        <SecondaryButton onClick={onRetake}>Retake</SecondaryButton>
      </div>
    </section>
  );
}

function PrimaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      className="min-h-12 flex-1 rounded-2xl bg-accent px-5 text-sm font-semibold text-ink shadow-[0_10px_24px_rgba(0,180,160,0.35)] sm:flex-none"
    >
      {children}
    </motion.button>
  );
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-12 flex-1 rounded-2xl border border-line bg-paper-bright px-5 text-sm font-semibold text-ink-soft transition hover:border-ink/25 sm:flex-none"
    >
      {children}
    </button>
  );
}
