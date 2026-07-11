import { useCallback, useEffect, useRef, useState } from "react";
import type { FacingMode } from "../types";

export type CameraPermission = "prompt" | "granted" | "denied" | "unsupported";

interface UseCameraOptions {
  initialFacing?: FacingMode;
}

interface UseCameraResult {
  permission: CameraPermission;
  facingMode: FacingMode;
  flashSupported: boolean;
  flashOn: boolean;
  error: string | null;
  stream: MediaStream | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  requestPermission: () => Promise<boolean>;
  switchCamera: () => void;
  toggleFlash: () => Promise<void>;
  captureFrame: () => string | null;
  stop: () => void;
}

async function getFacingStream(facing: FacingMode): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
}

export function useCamera(
  options: UseCameraOptions = {},
): UseCameraResult {
  const [permission, setPermission] = useState<CameraPermission>("prompt");
  const [facingMode, setFacingMode] = useState<FacingMode>(
    options.initialFacing ?? "environment",
  );
  const [flashSupported, setFlashSupported] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const attachStream = useCallback(async (next: MediaStream) => {
    stopTracks();
    streamRef.current = next;
    setStream(next);

    const track = next.getVideoTracks()[0];
    const caps = track?.getCapabilities?.() as
      | (MediaTrackCapabilities & { torch?: boolean })
      | undefined;
    setFlashSupported(Boolean(caps?.torch));
    setFlashOn(false);

    if (videoRef.current) {
      videoRef.current.srcObject = next;
      try {
        await videoRef.current.play();
      } catch {
        // Autoplay may be blocked until user gesture — preview still works
      }
    }
  }, [stopTracks]);

  const requestPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission("unsupported");
      setError("Camera API is not supported in this browser.");
      return false;
    }

    try {
      const next = await getFacingStream(facingMode);
      setPermission("granted");
      setError(null);
      await attachStream(next);
      return true;
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setPermission("denied");
        setError(
          "Camera permission was denied. You can still upload a photo from your gallery.",
        );
      } else if (name === "NotFoundError") {
        setPermission("denied");
        setError("No camera was found on this device.");
      } else {
        setPermission("denied");
        setError(
          err instanceof Error ? err.message : "Unable to access the camera.",
        );
      }
      return false;
    }
  }, [attachStream, facingMode]);

  const switchCamera = useCallback(() => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }, []);

  // Restart stream when facing mode changes after grant
  useEffect(() => {
    if (permission !== "granted") return;

    let cancelled = false;
    (async () => {
      try {
        const next = await getFacingStream(facingMode);
        if (cancelled) {
          next.getTracks().forEach((t) => t.stop());
          return;
        }
        await attachStream(next);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not switch camera.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [facingMode, permission, attachStream]);

  const toggleFlash = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !flashSupported) return;

    const next = !flashOn;
    try {
      await track.applyConstraints({
        // @ts-expect-error torch is a non-standard constraint supported on many mobiles
        advanced: [{ torch: next }],
      });
      setFlashOn(next);
    } catch {
      setError("Flash is not available on this camera.");
    }
  }, [flashOn, flashSupported]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Mirror front camera so capture matches preview
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.92);
  }, [facingMode]);

  const stop = useCallback(() => {
    stopTracks();
  }, [stopTracks]);

  useEffect(() => {
    return () => {
      stopTracks();
    };
  }, [stopTracks]);

  return {
    permission,
    facingMode,
    flashSupported,
    flashOn,
    error,
    stream,
    videoRef,
    requestPermission,
    switchCamera,
    toggleFlash,
    captureFrame,
    stop,
  };
}
