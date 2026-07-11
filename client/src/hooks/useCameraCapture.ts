import { useCallback, useEffect, useRef, useState } from "react";
import type Webcam from "react-webcam";
import type { FacingMode } from "../types";
import { isMobileDevice } from "../components/CameraView";

export type CameraPermission = "prompt" | "granted" | "denied" | "unsupported";

interface CameraProHandle {
  takePhoto: () => string;
  switchCamera?: () => FacingMode | void;
  toggleTorch?: () => boolean;
  torchSupported?: boolean;
}

export function useCameraCapture() {
  const [permission, setPermission] = useState<CameraPermission>("prompt");
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [flashSupported, setFlashSupported] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [usePro] = useState(() => isMobileDevice());

  const webcamRef = useRef<Webcam | null>(null);
  const cameraProRef = useRef<CameraProHandle | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const detectTorch = useCallback((stream: MediaStream | null) => {
    const track = stream?.getVideoTracks()[0];
    const caps = track?.getCapabilities?.() as
      | (MediaTrackCapabilities & { torch?: boolean })
      | undefined;
    setFlashSupported(Boolean(caps?.torch));
  }, []);

  const requestPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission("unsupported");
      setError("Camera API is not supported in this browser.");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: false,
      });
      streamRef.current = stream;
      detectTorch(stream);
      // Stop probe stream — Webcam / CameraPro will open their own
      stream.getTracks().forEach((t) => t.stop());
      setPermission("granted");
      setError(null);
      setReady(false);
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
  }, [detectTorch, facingMode]);

  const switchCamera = useCallback(() => {
    setFlashOn(false);
    if (usePro && cameraProRef.current?.switchCamera) {
      const next = cameraProRef.current.switchCamera();
      if (next === "user" || next === "environment") {
        setFacingMode(next);
      } else {
        setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
      }
      return;
    }
    setReady(false);
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }, [usePro]);

  const toggleFlash = useCallback(async () => {
    if (usePro && cameraProRef.current?.toggleTorch) {
      try {
        const on = cameraProRef.current.toggleTorch();
        setFlashOn(on);
        setFlashSupported(true);
        return;
      } catch {
        setError("Flash is not available on this camera.");
        return;
      }
    }

    const video = document.querySelector("video");
    const stream = (video?.srcObject as MediaStream | null) ?? streamRef.current;
    const track = stream?.getVideoTracks()[0];
    if (!track || !flashSupported) return;

    const next = !flashOn;
    try {
      await track.applyConstraints({
        // @ts-expect-error torch is non-standard but widely available on mobile
        advanced: [{ torch: next }],
      });
      setFlashOn(next);
    } catch {
      setError("Flash is not available on this camera.");
    }
  }, [flashOn, flashSupported, usePro]);

  const capture = useCallback((): string | null => {
    if (usePro && cameraProRef.current?.takePhoto) {
      try {
        return cameraProRef.current.takePhoto();
      } catch {
        // fall through
      }
    }
    return webcamRef.current?.getScreenshot() ?? null;
  }, [usePro]);

  const onCameraReady = useCallback(() => {
    setReady(true);
    setPermission("granted");
    const video = document.querySelector("video");
    if (video?.srcObject instanceof MediaStream) {
      streamRef.current = video.srcObject;
      detectTorch(video.srcObject);
    }
    if (usePro && cameraProRef.current) {
      setFlashSupported(Boolean(cameraProRef.current.torchSupported));
    }
  }, [detectTorch, usePro]);

  const onCameraError = useCallback((message: string) => {
    const denied =
      /permission|denied|NotAllowed/i.test(message) ||
      message.toLowerCase().includes("permission");
    setPermission(denied ? "denied" : "denied");
    setError(
      denied
        ? "Camera permission was denied. You can still upload a photo from your gallery."
        : message,
    );
    setReady(false);
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    permission,
    facingMode,
    flashSupported,
    flashOn,
    error,
    ready,
    usePro,
    webcamRef,
    cameraProRef,
    requestPermission,
    switchCamera,
    toggleFlash,
    capture,
    onCameraReady,
    onCameraError,
    setError,
  };
}
