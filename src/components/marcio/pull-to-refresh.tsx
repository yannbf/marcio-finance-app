"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "motion/react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client.ts";

const ARM_THRESHOLD = 70;
const MAX_PULL = 110;
const RESISTANCE = 0.5;

/**
 * Wrap a page in this to add iOS-style pull-to-refresh. Only mount it
 * on pages where it makes sense (Today, Activity). Wrapping the whole
 * app would pin every `position: fixed` descendant to this component's
 * transformed wrapper — motion.div always applies a `transform`, which
 * creates a containing block — and they'd scroll out of view alongside
 * the page.
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const utils = trpc.useUtils();
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const dragging = useRef(false);
  const y = useMotionValue(0);
  const [refreshing, setRefreshing] = useState(false);

  const indicatorY = useTransform(y, (v) => v - 28);
  const indicatorOpacity = useTransform(y, [0, ARM_THRESHOLD * 0.6], [0, 1]);
  const indicatorScale = useTransform(y, [0, ARM_THRESHOLD], [0.6, 1]);
  // Pre-arm rotation tracks the drag distance; once refreshing, switch to a
  // continuous spin animation (set on the inner element below).
  const dragRotate = useTransform(y, [0, MAX_PULL], [0, 270]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function reset(animated: boolean) {
      if (animated) animate(y, 0, { duration: 0.22, ease: [0.32, 0.72, 0.36, 1] });
      else y.set(0);
      startY.current = null;
      dragging.current = false;
    }

    function onTouchStart(e: TouchEvent) {
      if (refreshing) return;
      // Only arm at the very top of the document. Any nested scroll container
      // that's mid-scroll should keep its native behavior.
      if ((window.scrollY || document.documentElement.scrollTop) > 0) return;
      if (e.touches.length !== 1) return;
      startY.current = e.touches[0].clientY;
      dragging.current = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (refreshing) return;
      if (startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        // Upward — leave native scroll alone and disarm.
        if (dragging.current) {
          dragging.current = false;
          y.set(0);
        }
        return;
      }
      if ((window.scrollY || document.documentElement.scrollTop) > 0) {
        // User scrolled down before pulling; bail out.
        startY.current = null;
        if (dragging.current) {
          dragging.current = false;
          y.set(0);
        }
        return;
      }
      // Cancel iOS rubber-band so the native bounce doesn't fight our drag.
      if (e.cancelable) e.preventDefault();
      dragging.current = true;
      const resisted = Math.min(MAX_PULL, dy * RESISTANCE);
      y.set(resisted);
    }

    async function onTouchEnd() {
      if (!dragging.current) {
        startY.current = null;
        return;
      }
      const cur = y.get();
      startY.current = null;
      dragging.current = false;

      if (cur >= ARM_THRESHOLD && !refreshing) {
        setRefreshing(true);
        // Hold the indicator visible while the refetch runs.
        animate(y, 56, { duration: 0.18, ease: [0.32, 0.72, 0.36, 1] });
        try {
          await utils.invalidate();
        } finally {
          // Tiny breath so the spinner reads as "done" before collapsing.
          await new Promise((r) => window.setTimeout(r, 180));
          reset(true);
          setRefreshing(false);
        }
      } else {
        reset(true);
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    // touchmove must be non-passive so we can preventDefault inside the pull.
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [refreshing, utils, y]);

  return (
    <div ref={containerRef} className="relative">
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center"
        style={{
          y: indicatorY,
          opacity: indicatorOpacity,
          scale: indicatorScale,
        }}
      >
        <div className="grid size-9 place-items-center rounded-full border border-border/60 bg-card/90 text-foreground shadow-lg backdrop-blur">
          <motion.div
            style={refreshing ? undefined : { rotate: dragRotate }}
            animate={refreshing ? { rotate: 360 } : undefined}
            transition={
              refreshing
                ? { repeat: Infinity, ease: "linear", duration: 0.9 }
                : undefined
            }
            className="grid place-items-center"
          >
            <Loader2 className="size-4" />
          </motion.div>
        </div>
      </motion.div>

      <motion.div style={{ y }}>{children}</motion.div>
    </div>
  );
}
