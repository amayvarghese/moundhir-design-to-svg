import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import toast, { Toaster } from "react-hot-toast";
import { Header } from "./components/Header";
import { CameraView } from "./components/CameraView";
import { CameraControls } from "./components/CameraControls";
import { ImagePreview } from "./components/ImagePreview";
import { GeneratingOverlay } from "./components/GeneratingOverlay";
import { SvgPreview } from "./components/SvgPreview";
import { SvgCode } from "./components/SvgCode";
import { ResultActions } from "./components/ResultActions";
import { PermissionDenied } from "./components/PermissionDenied";
import { useCameraCapture } from "./hooks/useCameraCapture";
import {
  copyToClipboard,
  cropAndCenterDrawing,
  downloadSvgAsPng,
  downloadTextFile,
  generateSvg,
  loadPersistedSvg,
  persistSvg,
} from "./lib/api";
import type { AppPhase, GenerateMeta, TraceMode } from "./types";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const camera = useCameraCapture();
  const [phase, setPhase] = useState<AppPhase>("camera");
  const [captured, setCaptured] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [meta, setMeta] = useState<GenerateMeta | null>(null);
  const [mode, setMode] = useState<TraceMode>("technical");

  // Request camera on load
  useEffect(() => {
    void (async () => {
      const ok = await camera.requestPermission();
      if (!ok) setPhase("denied");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore last SVG from localStorage
  useEffect(() => {
    const stored = loadPersistedSvg();
    if (stored?.svg) {
      setSvg(stored.svg);
      setMeta(stored.meta);
      if (stored.sourceImage) setCaptured(stored.sourceImage);
    }
  }, []);

  const handleCapture = useCallback(async () => {
    const shot = camera.capture();
    if (!shot) {
      toast.error("Could not capture frame. Wait for the camera to be ready.");
      return;
    }
    try {
      const cropped = await cropAndCenterDrawing(shot);
      setCaptured(cropped);
      setPhase("preview");
      setSvg(null);
      setMeta(null);
    } catch {
      setCaptured(shot);
      setPhase("preview");
    }
  }, [camera]);

  const handleUpload = useCallback(async (file: File) => {
    try {
      const dataUrl = await fileToDataUrl(file);
      const cropped = await cropAndCenterDrawing(dataUrl);
      setCaptured(cropped);
      setPhase("preview");
      setSvg(null);
      setMeta(null);
      toast.success("Image loaded");
    } catch {
      toast.error("Could not load that image");
    }
  }, []);

  const handleRetake = useCallback(() => {
    setCaptured(null);
    setSvg(null);
    setMeta(null);
    setPhase(camera.permission === "granted" ? "camera" : "denied");
    if (camera.permission !== "granted") {
      void camera.requestPermission().then((ok) => {
        setPhase(ok ? "camera" : "denied");
      });
    }
  }, [camera]);

  const handleGenerate = useCallback(async () => {
    if (!captured) return;
    setPhase("generating");
    try {
      // captured is already a data URL (base64) from camera / gallery
      const result = await generateSvg(captured, mode);
      setSvg(result.svg);
      setMeta(result.meta);
      persistSvg({
        svg: result.svg,
        meta: result.meta,
        savedAt: new Date().toISOString(),
        sourceImage: captured,
      });
      setPhase("result");
      toast.success(
        result.meta.retried
          ? `SVG ready (${(result.meta.elapsedMs / 1000).toFixed(1)}s, retried)`
          : `SVG ready in ${(result.meta.elapsedMs / 1000).toFixed(1)}s`,
      );
    } catch (err) {
      setPhase("preview");
      toast.error(err instanceof Error ? err.message : "Generation failed");
    }
  }, [captured, mode]);

  const handleCopy = useCallback(async () => {
    if (!svg) return;
    try {
      await copyToClipboard(svg);
      toast.success("SVG copied");
    } catch {
      toast.error("Copy failed");
    }
  }, [svg]);

  const handleDownloadSvg = useCallback(() => {
    if (!svg) return;
    downloadTextFile(svg, `sketch2svg-${Date.now()}.svg`);
    toast.success("SVG downloaded");
  }, [svg]);

  const handleDownloadPng = useCallback(async () => {
    if (!svg) return;
    try {
      await downloadSvgAsPng(svg, `sketch2svg-${Date.now()}.png`);
      toast.success("PNG downloaded");
    } catch {
      toast.error("PNG export failed");
    }
  }, [svg]);

  const showCamera =
    phase === "camera" && camera.permission === "granted";
  const showDenied =
    phase === "denied" ||
    (phase === "camera" &&
      (camera.permission === "denied" ||
        camera.permission === "unsupported"));

  return (
    <div className="min-h-dvh pb-8">
      <Toaster
        position="top-center"
        toastOptions={{
          className: "font-sans text-sm",
          style: {
            background: "#0B1F33",
            color: "#F4F8FC",
            borderRadius: "14px",
          },
        }}
      />

      <Header />

      <main className="mx-auto mt-6 flex w-full max-w-5xl flex-col gap-8">
        {showDenied && (
          <PermissionDenied
            message={
              camera.error ||
              "Camera permission was denied. Upload a photo instead."
            }
            onRetry={async () => {
              const ok = await camera.requestPermission();
              setPhase(ok ? "camera" : "denied");
            }}
            onUpload={handleUpload}
          />
        )}

        {showCamera && (
          <>
            <div className="px-4 sm:px-6">
              <div className="mx-auto aspect-[3/4] max-h-[min(68vh,640px)] w-full max-w-md sm:aspect-[4/5]">
                <CameraView
                  facingMode={camera.facingMode}
                  usePro={camera.usePro}
                  webcamRef={camera.webcamRef}
                  cameraProRef={camera.cameraProRef}
                  onReady={camera.onCameraReady}
                  onError={camera.onCameraError}
                />
              </div>
            </div>
            <CameraControls
              facingMode={camera.facingMode}
              flashSupported={camera.flashSupported}
              flashOn={camera.flashOn}
              ready={camera.ready}
              onCapture={handleCapture}
              onSwitch={camera.switchCamera}
              onFlash={() => void camera.toggleFlash()}
              onUpload={handleUpload}
            />
          </>
        )}

        {(phase === "preview" || phase === "generating") && captured && (
          <ImagePreview
            src={captured}
            onRetake={handleRetake}
            onGenerate={() => void handleGenerate()}
            generating={phase === "generating"}
            mode={mode}
            onModeChange={setMode}
          />
        )}

        {phase === "result" && svg && meta && (
          <>
            {captured && (
              <div className="px-4 sm:px-6">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft/60">
                  Source
                </p>
                <img
                  src={captured}
                  alt="Source sketch"
                  className="h-20 w-20 rounded-xl object-cover ring-1 ring-line/60"
                />
              </div>
            )}
            <SvgPreview svg={svg} meta={meta} />
            <SvgCode svg={svg} onCopy={() => void handleCopy()} />
            <ResultActions
              onDownloadSvg={handleDownloadSvg}
              onDownloadPng={() => void handleDownloadPng()}
              onCopy={() => void handleCopy()}
              onRetake={handleRetake}
            />
          </>
        )}

        {/* Persist-restore strip when visiting with saved SVG but starting on camera */}
        {phase === "camera" && svg && meta && (
          <section className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setPhase("result")}
              className="w-full rounded-2xl border border-dashed border-line bg-paper-bright/60 px-4 py-3 text-left text-sm text-ink-soft transition hover:border-accent/50"
            >
              Open last generated SVG
              {meta.elapsedMs
                ? ` · ${(meta.elapsedMs / 1000).toFixed(1)}s`
                : ""}
            </button>
          </section>
        )}
      </main>

      <AnimatePresence>
        {phase === "generating" && <GeneratingOverlay />}
      </AnimatePresence>
    </div>
  );
}
