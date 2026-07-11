import { useEffect, useRef } from "react";
import Webcam from "react-webcam";
import { Camera as CameraPro } from "react-camera-pro";
import { motion } from "framer-motion";
import type { FacingMode } from "../types";

interface CameraProHandle {
  takePhoto: () => string;
  switchCamera?: () => FacingMode | void;
  toggleTorch?: () => boolean;
  torchSupported?: boolean;
}

interface CameraViewProps {
  facingMode: FacingMode;
  usePro: boolean;
  webcamRef: React.RefObject<Webcam | null>;
  cameraProRef: React.MutableRefObject<CameraProHandle | null>;
  onReady?: () => void;
  onError?: (message: string) => void;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function CameraView({
  facingMode,
  usePro,
  webcamRef,
  cameraProRef,
  onReady,
  onError,
}: CameraViewProps) {
  const readySent = useRef(false);

  useEffect(() => {
    readySent.current = false;
  }, [facingMode, usePro]);

  const markReady = () => {
    if (!readySent.current) {
      readySent.current = true;
      onReady?.();
    }
  };

  return (
    <motion.div
      className="relative h-full w-full overflow-hidden rounded-[1.5rem] bg-ink"
      initial={{ opacity: 0.6, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35 }}
    >
      {usePro ? (
        <div className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover">
          <CameraPro
            ref={cameraProRef as never}
            facingMode={facingMode}
            aspectRatio="cover"
            videoReadyCallback={markReady}
            errorMessages={{
              noCameraAccessible:
                "No camera device accessible. Please connect your camera or try another browser.",
              permissionDenied:
                "Camera permission denied. Please refresh and allow camera access.",
              switchCamera:
                "It is not possible to switch camera to the other orientation.",
              canvas: "Canvas is not supported.",
            }}
          />
        </div>
      ) : (
        <Webcam
          ref={webcamRef}
          audio={false}
          mirrored={facingMode === "user"}
          screenshotFormat="image/jpeg"
          screenshotQuality={0.92}
          forceScreenshotSourceSize
          videoConstraints={{
            facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          }}
          onUserMedia={markReady}
          onUserMediaError={(err) => {
            const message =
              typeof err === "string"
                ? err
                : err?.message || "Unable to access camera";
            onError?.(message);
          }}
          className="h-full w-full object-cover"
        />
      )}
      <CropOverlay />
    </motion.div>
  );
}

function CropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="relative aspect-square w-[min(86%,420px)]">
        <div className="absolute inset-0 rounded-2xl border border-white/35 shadow-[0_0_0_9999px_rgba(11,31,51,0.28)]" />
        <span className="absolute left-0 top-0 h-5 w-5 rounded-tl-xl border-l-2 border-t-2 border-accent" />
        <span className="absolute right-0 top-0 h-5 w-5 rounded-tr-xl border-r-2 border-t-2 border-accent" />
        <span className="absolute bottom-0 left-0 h-5 w-5 rounded-bl-xl border-b-2 border-l-2 border-accent" />
        <span className="absolute bottom-0 right-0 h-5 w-5 rounded-br-xl border-b-2 border-r-2 border-accent" />
        <p className="absolute -bottom-8 left-1/2 w-max -translate-x-1/2 text-center text-xs font-medium tracking-wide text-white/80">
          Center your drawing in the frame
        </p>
      </div>
    </div>
  );
}
