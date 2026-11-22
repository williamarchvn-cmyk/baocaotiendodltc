import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Loader2 } from 'lucide-react';

interface Props {
  src: string;
  /** Ảnh thu nhỏ (thường đã có trong bộ nhớ trình duyệt) → hiện ngay trong lúc chờ ảnh nét. */
  placeholder?: string;
  onBackgroundClick: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

interface View {
  s: number;
  x: number;
  y: number;
}

// Ảnh phóng to: lăn chuột / nút +/- / chụm 2 ngón / nhấp đúp để zoom, kéo để di chuyển khi đã zoom.
// Kích thước khung hiển thị tối đa, giống ràng buộc max-w/max-h cũ của ảnh phóng to
function maxBox() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return w >= 640 ? { w: w * 0.85, h: h * 0.85 } : { w: w - 8, h: h * 0.8 };
}

export default function ZoomableImage({ src, placeholder, onBackgroundClick }: Props) {
  const [natural, setNatural] = useState<{ w: number; h: number; full: boolean } | null>(null);
  const [fullLoaded, setFullLoaded] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(!placeholder || placeholder === src);
  const [box, setBox] = useState(maxBox);

  useEffect(() => {
    const onResize = () => setBox(maxBox());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Kích thước hiển thị: vừa khung; ảnh nét thì không phóng to quá kích thước thật (như trước)
  let size: { w: number; h: number } | null = null;
  if (natural) {
    let k = Math.min(box.w / natural.w, box.h / natural.h);
    if (natural.full) k = Math.min(1, k);
    size = { w: Math.round(natural.w * k), h: Math.round(natural.h * k) };
  }

  const surfaceRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [dragging, setDragging] = useState(false);

  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gesture = useRef<{
    startDist: number;
    startScale: number;
    startView: View;
    startCx: number;
    startCy: number;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const blockSwipe = useRef(false);

  const clamp = useCallback((v: View): View => {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s));
    const surface = surfaceRef.current;
    const img = imgRef.current;
    if (!surface || !img || s <= 1) return { s, x: 0, y: 0 };
    const maxX = Math.max(0, (img.offsetWidth * s - surface.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * s - surface.clientHeight) / 2);
    return {
      s,
      x: Math.min(maxX, Math.max(-maxX, v.x)),
      y: Math.min(maxY, Math.max(-maxY, v.y))
    };
  }, []);

  // Phóng/thu quanh một điểm (toạ độ màn hình)
  const zoomAt = useCallback(
    (newScale: number, clientX?: number, clientY?: number) => {
      const surface = surfaceRef.current;
      const cur = viewRef.current;
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      const px = (clientX ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
      const py = (clientY ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
      const k = s / cur.s;
      setView(clamp({ s, x: px - (px - cur.x) * k, y: py - (py - cur.y) * k }));
    },
    [clamp]
  );

  const reset = useCallback(() => setView({ s: 1, x: 0, y: 0 }), []);

  // Phím tắt: + / - / 0
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') zoomAt(viewRef.current.s * 1.4);
      else if (e.key === '-' || e.key === '_') zoomAt(viewRef.current.s / 1.4);
      else if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomAt, reset]);

  const onWheel = (e: React.WheelEvent) => {
    const factor = Math.exp(-e.deltaY * 0.002);
    zoomAt(viewRef.current.s * factor, e.clientX, e.clientY);
  };

  const dist = () => {
    const [a, b] = Array.from(pointers.current.values());
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const center = () => {
    const [a, b] = Array.from(pointers.current.values());
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const beginGesture = () => {
    const pts = Array.from(pointers.current.values());
    if (pts.length === 0) {
      gesture.current = null;
      return;
    }
    const c = pts.length >= 2 ? center() : pts[0];
    gesture.current = {
      startDist: pts.length >= 2 ? dist() : 0,
      startScale: viewRef.current.s,
      startView: viewRef.current,
      startCx: c.x,
      startCy: c.y,
      moved: gesture.current?.moved ?? false
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    surfaceRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = null;
    beginGesture();
    if (pointers.current.size >= 2 || viewRef.current.s > 1) blockSwipe.current = true;
    if (gesture.current) gesture.current.moved = pointers.current.size >= 2;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const ox = rect.left + rect.width / 2;
    const oy = rect.top + rect.height / 2;

    if (pointers.current.size >= 2 && g.startDist > 0) {
      const c = center();
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, g.startScale * (dist() / g.startDist)));
      const k = s / g.startView.s;
      const px = g.startCx - ox;
      const py = g.startCy - oy;
      setView(
        clamp({
          s,
          x: c.x - ox - (px - g.startView.x) * k,
          y: c.y - oy - (py - g.startView.y) * k
        })
      );
      g.moved = true;
      setDragging(true);
    } else if (pointers.current.size === 1 && viewRef.current.s > 1) {
      const c = pointers.current.get(e.pointerId)!;
      const dx = c.x - g.startCx;
      const dy = c.y - g.startCy;
      if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
      setView(clamp({ s: g.startView.s, x: g.startView.x + dx, y: g.startView.y + dy }));
      setDragging(true);
    } else {
      const c = pointers.current.get(e.pointerId)!;
      if (Math.abs(c.x - g.startCx) + Math.abs(c.y - g.startCy) > 8) g.moved = true;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const wasMoved = gesture.current?.moved ?? false;
    const wasMulti = pointers.current.size >= 2;
    pointers.current.delete(e.pointerId);
    setDragging(false);

    if (pointers.current.size > 0) {
      beginGesture(); // còn 1 ngón → tiếp tục kéo từ vị trí mới
      if (gesture.current) gesture.current.moved = true;
      return;
    }
    gesture.current = null;

    if (wasMoved || wasMulti) {
      lastTap.current = null;
      return;
    }

    // Chạm / nhấp đơn giản
    const now = Date.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < 320 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
      lastTap.current = null;
      if (viewRef.current.s > 1.01) reset();
      else zoomAt(DOUBLE_TAP_SCALE, e.clientX, e.clientY);
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    // Nhấp ra ngoài ảnh (khi chưa zoom) → đóng
    const onImage = !!imgRef.current && imgRef.current.contains(e.target as Node);
    if (!onImage && viewRef.current.s <= 1.01) {
      const t = window.setTimeout(() => {
        if (lastTap.current && lastTap.current.t === now) onBackgroundClick();
      }, 330);
      void t;
    }
  };

  // Khi đang zoom / chụm 2 ngón: không cho thao tác vuốt chuyển ảnh ở lớp ngoài nhận
  const stopSwipeIfNeeded = (e: React.TouchEvent) => {
    if (e.touches.length > 1 || viewRef.current.s > 1.01 || blockSwipe.current) e.stopPropagation();
    if (e.type === 'touchend' && e.touches.length === 0) blockSwipe.current = false;
  };

  const pct = Math.round(view.s * 100);

  return (
    <>
      <div
        ref={surfaceRef}
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ touchAction: 'none', cursor: view.s > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onTouchStart={stopSwipeIfNeeded}
        onTouchEnd={stopSwipeIfNeeded}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={imgRef}
          className="relative rounded-xl shadow-2xl border border-white/10 overflow-hidden bg-slate-900"
          style={{
            width: size?.w ?? 0,
            height: size?.h ?? 0,
            visibility: size ? 'visible' : 'hidden',
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
            transition: dragging ? 'none' : 'transform 0.15s ease-out',
            willChange: view.s > 1 ? 'transform' : undefined
          }}
        >
          {!thumbFailed && !fullLoaded && (
            <img
              src={placeholder}
              crossOrigin="anonymous"
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
              onLoad={(e) => {
                const t = e.currentTarget;
                setNatural((cur) => cur ?? { w: t.naturalWidth, h: t.naturalHeight, full: false });
              }}
              onError={() => setThumbFailed(true)}
              alt=""
            />
          )}
          <img
            src={src}
            crossOrigin="anonymous"
            decoding="async"
            draggable={false}
            className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none transition-opacity duration-200"
            style={{ opacity: fullLoaded ? 1 : 0 }}
            onLoad={(e) => {
              const t = e.currentTarget;
              setNatural({ w: t.naturalWidth, h: t.naturalHeight, full: true });
              setFullLoaded(true);
            }}
            alt="Ảnh phóng to"
          />
        </div>
        {!fullLoaded && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="w-8 h-8 text-white/70 animate-spin" />
          </div>
        )}
      </div>

      <div
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 sm:top-6 sm:left-6 z-50 flex items-center gap-1 bg-white/10 border border-white/10 rounded-full p-1"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => zoomAt(view.s / 1.5)}
          disabled={view.s <= MIN_SCALE}
          className="w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/15 disabled:opacity-30 cursor-pointer"
          aria-label="Thu nhỏ"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <span className="text-white/80 text-xs font-mono font-bold w-11 text-center tabular-nums">{pct}%</span>
        <button
          onClick={() => zoomAt(view.s * 1.5)}
          disabled={view.s >= MAX_SCALE}
          className="w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/15 disabled:opacity-30 cursor-pointer"
          aria-label="Phóng to"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          onClick={reset}
          disabled={view.s <= 1}
          className="w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/15 disabled:opacity-30 cursor-pointer"
          aria-label="Về kích thước gốc"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </>
  );
}
