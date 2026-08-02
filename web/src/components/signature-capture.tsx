import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

interface Point {
  x: number;
  y: number;
}

export interface SignatureCaptureProps {
  /**
   * Fires when a stroke ends with a white-backed PNG data URL, or `null` once the
   * pad is empty.
   */
  onChange?: (png: string | null) => void;
  /** Ink colour. Defaults to near-black so it reads on the white pad and in print. */
  penColor?: string;
  /** Stroke width in CSS pixels. */
  lineWidth?: number;
  ariaLabel?: string;
}

/**
 * On-device signature pad (SPEC §6 path A). Pointer Events unify finger, stylus,
 * and mouse in one code path. The backing store is sized to `devicePixelRatio`
 * so ink stays crisp on a tablet, and `touch-action: none` (see styles.css) stops
 * the page scrolling while the signer draws. Strokes are retained as points so the
 * drawing survives an orientation change instead of blurring or clearing.
 *
 * This is the capture control only — it is deliberately not wired to a record or to
 * storage. The parent receives the PNG through `onChange` and decides what to do.
 */
export function SignatureCapture(props: SignatureCaptureProps): ReactNode {
  const {
    onChange,
    penColor = "#0f172a",
    lineWidth = 2.5,
    ariaLabel = "Signature",
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const strokesRef = useRef<Point[][]>([]);
  const activeStrokeRef = useRef<Point[] | null>(null);
  const cssSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // Latest prop values without re-running the setup effect on every change.
  const penColorRef = useRef(penColor);
  penColorRef.current = penColor;
  const lineWidthRef = useRef(lineWidth);
  lineWidthRef.current = lineWidth;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [hasInk, setHasInk] = useState(false);

  const applyStyle = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = penColorRef.current;
    ctx.fillStyle = penColorRef.current;
    ctx.lineWidth = lineWidthRef.current;
  }, []);

  const redraw = useCallback((ctx: CanvasRenderingContext2D) => {
    for (const stroke of strokesRef.current) {
      const first = stroke[0];
      if (!first) continue;
      if (stroke.length === 1) {
        ctx.beginPath();
        ctx.arc(first.x, first.y, lineWidthRef.current / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < stroke.length; i++) {
        const p = stroke[i]!;
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }, []);

  // Size the backing store to the CSS box × devicePixelRatio and re-apply the
  // transform. Setting canvas.width/height clears it, so redraw after a resize.
  const configure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    const resized = canvas.width !== w || canvas.height !== h;
    if (resized) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyStyle(ctx);
    ctxRef.current = ctx;
    cssSizeRef.current = { w: rect.width, h: rect.height };
    if (resized) redraw(ctx);
  }, [applyStyle, redraw]);

  useEffect(() => {
    configure();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    // Reconfigure on layout or orientation change (iPad rotate), preserving ink.
    const observer = new ResizeObserver(() => configure());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [configure]);

  // Coalesced events give the full high-frequency point trail between frames,
  // which keeps stylus strokes smooth on a tablet.
  const pointsFrom = (e: ReactPointerEvent<HTMLCanvasElement>): Point[] => {
    const canvas = canvasRef.current;
    if (!canvas) return [];
    const rect = canvas.getBoundingClientRect();
    const native = e.nativeEvent;
    const coalesced =
      typeof native.getCoalescedEvents === "function"
        ? native.getCoalescedEvents()
        : [];
    const source = coalesced.length > 0 ? coalesced : [native];
    return source.map((ev) => ({
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
    }));
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!e.isPrimary) return; // ignore a second finger / palm
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    const start = pointsFrom(e)[0];
    if (!ctx || !canvas || !start) return;
    canvas.setPointerCapture(e.pointerId);
    const stroke: Point[] = [start];
    strokesRef.current.push(stroke);
    activeStrokeRef.current = stroke;
    // A tap with no movement should still leave a mark.
    ctx.beginPath();
    ctx.arc(start.x, start.y, lineWidthRef.current / 2, 0, Math.PI * 2);
    ctx.fill();
    if (!hasInk) setHasInk(true);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!e.isPrimary) return;
    const ctx = ctxRef.current;
    const stroke = activeStrokeRef.current;
    if (!ctx || !stroke) return;
    for (const p of pointsFrom(e)) {
      const prev = stroke[stroke.length - 1]!;
      stroke.push(p);
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  };

  // The live canvas is transparent (so the CSS baseline shows through); the export
  // composites the ink onto white so the PNG carries its own background, at full
  // device resolution.
  const exportPng = (): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext("2d");
    if (!octx) return null;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(canvas, 0, 0);
    return out.toDataURL("image/png");
  };

  const endStroke = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!activeStrokeRef.current) return;
    activeStrokeRef.current = null;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    onChangeRef.current?.(strokesRef.current.length > 0 ? exportPng() : null);
  };

  const clear = () => {
    strokesRef.current = [];
    activeStrokeRef.current = null;
    const { w, h } = cssSizeRef.current;
    ctxRef.current?.clearRect(0, 0, w, h);
    setHasInk(false);
    onChangeRef.current?.(null);
  };

  return (
    <div className="sig-capture">
      <div className="sig-capture-pad">
        <canvas
          ref={canvasRef}
          className="sig-capture-canvas"
          role="img"
          aria-label={ariaLabel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
        <span className="sig-capture-baseline" aria-hidden="true" />
        {!hasInk && (
          <span className="sig-capture-hint" aria-hidden="true">
            Sign here
          </span>
        )}
      </div>
      <div className="sig-capture-toolbar">
        <button
          type="button"
          className="sig-capture-clear"
          onClick={clear}
          disabled={!hasInk}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
