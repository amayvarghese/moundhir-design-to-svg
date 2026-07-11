import { motion } from "framer-motion";

interface PermissionDeniedProps {
  message: string;
  onRetry: () => void;
  onUpload: (file: File) => void;
}

export function PermissionDenied({
  message,
  onRetry,
  onUpload,
}: PermissionDeniedProps) {
  return (
    <motion.section
      className="mx-auto w-full max-w-lg px-4 sm:px-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="rounded-[1.75rem] border border-warn/30 bg-paper-bright p-6 shadow-lg sm:p-8">
        <h2 className="font-display text-2xl font-bold text-ink">
          Camera unavailable
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft/85">{message}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="min-h-12 rounded-2xl bg-ink px-5 text-sm font-semibold text-paper"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              const input = document.getElementById(
                "denied-upload",
              ) as HTMLInputElement | null;
              input?.click();
            }}
            className="min-h-12 rounded-2xl border border-line bg-paper px-5 text-sm font-semibold text-ink-soft"
          >
            Upload from Gallery
          </button>
        </div>
        <input
          id="denied-upload"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
      </div>
    </motion.section>
  );
}
