import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "wouter";
import { Sparkles } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

const FAB_SIZE = 64;
/** BottomNav tap row (matches `h-16` / 4rem). */
const NAV_BAR_HEIGHT_PX = 64;
/** `right: 1rem` — margin from viewport right edge. */
const FAB_MARGIN_FROM_RIGHT_PX = 16;
/** Gap between FAB bottom and top of nav stack (1rem above nav bar). */
const FAB_GAP_ABOVE_NAV_STACK_PX = 16;
const DRAG_THRESHOLD_PX = 10;
const MARGIN_EDGE = 8;

function getSafeAreaInsetBottomPx(): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.setAttribute(
    "style",
    "position:fixed;bottom:0;left:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none"
  );
  document.documentElement.appendChild(probe);
  const h = probe.offsetHeight;
  document.documentElement.removeChild(probe);
  return h;
}

// Session-only in-memory store: survives route changes, cleared on full page refresh
// Stored as top-left (left, top) in viewport px so dragged mode uses one coordinate system
let storedFabPosition: { left: number; top: number } | null = null;
function getStoredFabPosition(): { left: number; top: number } | null {
  return storedFabPosition;
}
function setStoredFabPosition(pos: { left: number; top: number } | null): void {
  storedFabPosition = pos;
}

function getDefaultTopLeft(): { left: number; top: number } {
  if (typeof window === "undefined") return { left: 0, top: 0 };
  const safeBottom = getSafeAreaInsetBottomPx();
  const bottomOffsetPx =
    NAV_BAR_HEIGHT_PX + safeBottom + FAB_GAP_ABOVE_NAV_STACK_PX;
  return {
    left: window.innerWidth - FAB_SIZE - FAB_MARGIN_FROM_RIGHT_PX,
    top: window.innerHeight - bottomOffsetPx - FAB_SIZE,
  };
}

function clampTopLeft(
  left: number,
  top: number
): { left: number; top: number } {
  if (typeof window === "undefined") return { left, top };
  const minLeft = MARGIN_EDGE;
  const maxLeft = window.innerWidth - FAB_SIZE - MARGIN_EDGE;
  const minTop = MARGIN_EDGE;
  const maxTop = window.innerHeight - FAB_SIZE - MARGIN_EDGE;
  return {
    left: Math.max(minLeft, Math.min(maxLeft, left)),
    top: Math.max(minTop, Math.min(maxTop, top)),
  };
}

export function SupportFab() {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    () => getStoredFabPosition()
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const positionStartRef = useRef<{ left: number; top: number }>({ left: 0, top: 0 });
  const hasDraggedThisGestureRef = useRef(false);

  const getCurrentTopLeft = useCallback(
    () => position ?? getDefaultTopLeft(),
    [position]
  );

  const updatePosition = useCallback(
    (next: { left: number; top: number } | null) => {
      setStoredFabPosition(next);
      setPosition(next);
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
      positionStartRef.current = getCurrentTopLeft();
      hasDraggedThisGestureRef.current = false;
      setIsDragging(true);
    },
    [getCurrentTopLeft]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragStartRef.current === null) return;
      const dx = e.clientX - dragStartRef.current.clientX;
      const dy = e.clientY - dragStartRef.current.clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > DRAG_THRESHOLD_PX) {
        hasDraggedThisGestureRef.current = true;
        const rawLeft = positionStartRef.current.left + dx;
        const rawTop = positionStartRef.current.top + dy;
        const next = clampTopLeft(rawLeft, rawTop);
        updatePosition(next);
      }
    },
    [updatePosition]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStartRef.current = null;
    setIsDragging(false);
  }, []);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStartRef.current = null;
    setIsDragging(false);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (hasDraggedThisGestureRef.current) {
      e.preventDefault();
    }
    hasDraggedThisGestureRef.current = false;
  }, []);

  useEffect(() => {
    if (position === null) return;
    const onResize = () => {
      setPosition((prev) => {
        if (!prev) return null;
        const clamped = clampTopLeft(prev.left, prev.top);
        setStoredFabPosition(clamped);
        return clamped;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [position]);

  const isMobile = useIsMobile();
  const [location] = useLocation();
  /**
   * Screens that park their own action bar on top of the nav.
   *
   * Only booking today. Kept as a list rather than a prop because the FAB is
   * mounted by BottomNav, not by the page, so the page has no way to tell it.
   */
  const hasStickyActions = location === '/create';

  const isPositioned = position !== null;

  // Default mode: only bottom, let .fab-wrapper provide left: 50%
  // Dragged mode: explicit viewport-fixed top-left, all other positioning cleared
  // touch-action: none so the browser does not consume touch drags as scroll/pan (RCA fix)
  const style: React.CSSProperties = isPositioned
    ? {
        position: "fixed",
        left: position.left,
        top: position.top,
        bottom: "auto",
        right: "auto",
        transform: "none",
        touchAction: "none",
      }
    : {
        left: "auto",
        right: "1rem",
        // Cleared over a screen that parks its own action bar on the nav.
        // Booking has Continue down there, and a floating button sitting on
        // top of the one action the customer came to press is a tap they lose
        // to the wrong target.
        bottom: hasStickyActions
          ? "calc(4rem + env(safe-area-inset-bottom, 0px) + 5.5rem)"
          : "calc(4rem + env(safe-area-inset-bottom, 0px) + 1rem)",
        touchAction: "none",
      };

  if (!isMobile) return null;

  const fabContent = (
    <div
      className={`fab-wrapper ${isPositioned ? "fab-wrapper-dragged" : ""}`}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      role="presentation"
    >
      <div className="fab-aura" aria-hidden />
      <Link
        href="/help"
        className={`fab-button ${isDragging ? "fab-dragging" : ""}`}
        aria-label="Open Support Assistant"
        data-testid="fab-support"
        onClick={handleClick}
      >
        <span className="fab-icon-wrap">
          <Sparkles className="h-7 w-7" strokeWidth={2} aria-hidden />
        </span>
      </Link>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(fabContent, document.body);
  }
  return fabContent;
}
