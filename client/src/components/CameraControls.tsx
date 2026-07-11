import { motion } from "framer-motion";

interface CameraControlsProps {
  facingMode: "user" | "environment";
  flashSupported: boolean;
  flashOn: boolean;
  ready: boolean;
  disabled?: boolean;
  onCapture: () => void;
  onSwitch: () => void;
  onFlash: () => void;
  onUpload: (file: File) => void;
}

export function CameraControls({
  facingMode,
  flashSupported,
  flashOn,
  ready,
  disabled,
  onCapture,
  onSwitch,
  onFlash,
  onUpload,
}: CameraControlsProps) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-4">
      <div className="flex w-full items-center justify-between gap-3">
        <ControlButton
          label="Gallery"
          onClick={() => {
            const input = document.getElementById(
              "gallery-upload",
            ) as HTMLInputElement | null;
            input?.click();
          }}
          disabled={disabled}
        >
          <GalleryIcon />
        </ControlButton>

        <motion.button
          type="button"
          aria-label="Capture"
          disabled={!ready || disabled}
          onClick={onCapture}
          whileTap={{ scale: 0.94 }}
          className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full bg-ink text-paper shadow-[0_12px_30px_rgba(11,31,51,0.35)] transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="absolute inset-1.5 rounded-full border-2 border-accent" />
          <span className="h-14 w-14 rounded-full bg-paper-bright" />
        </motion.button>

        <ControlButton
          label={facingMode === "user" ? "Front" : "Rear"}
          onClick={onSwitch}
          disabled={disabled}
        >
          <FlipIcon />
        </ControlButton>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onFlash}
          disabled={!flashSupported || disabled}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition ${
            flashOn
              ? "bg-accent text-ink"
              : "bg-paper-bright/80 text-ink-soft hover:bg-paper-bright"
          } disabled:cursor-not-allowed disabled:opacity-40`}
          aria-pressed={flashOn}
        >
          <FlashIcon on={flashOn} />
          Flash {flashSupported ? (flashOn ? "On" : "Off") : "N/A"}
        </button>
      </div>

      <input
        id="gallery-upload"
        type="file"
        accept="image/*"
        capture={undefined}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ControlButton({
  label,
  children,
  onClick,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-11 min-w-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl bg-paper-bright/80 px-3 py-2 text-xs font-medium text-ink-soft backdrop-blur transition hover:bg-paper-bright disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
      {label}
    </button>
  );
}

function GalleryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="10" r="1.6" fill="currentColor" />
      <path d="M3 16l5-4 4 3 3-2 6 4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 7h7a4 4 0 014 4v1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M9 5L7 7l2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M17 17H10a4 4 0 01-4-4v-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M15 19l2-2-2-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FlashIcon({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} aria-hidden>
      <path
        d="M13 2L4 14h7l-1 8 10-14h-7l0-6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
