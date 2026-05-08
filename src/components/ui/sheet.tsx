"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import {
  motion,
  useMotionValue,
  useDragControls,
  animate,
  type PanInfo,
} from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  showHandle,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  /** iOS-style drag-handle indicator. Defaults on for `side="bottom"`. */
  showHandle?: boolean
}) {
  const handle = showHandle ?? side === "bottom"
  const isBottom = side === "bottom"
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          // Bottom sheets paint their own background on the inner motion
          // wrapper so the colored container drags down with the content
          // instead of leaving a fixed-height stripe behind.
          "fixed z-50 flex flex-col gap-4 text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem] data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
          isBottom
            ? null
            : "bg-popover bg-clip-padding",
          className
        )}
        {...props}
      >
        {isBottom ? (
          <BottomSheetDraggable
            showHandle={handle}
            showCloseButton={showCloseButton}
          >
            {children}
          </BottomSheetDraggable>
        ) : (
          <>
            {children}
            {showCloseButton && (
              <SheetPrimitive.Close
                data-slot="sheet-close"
                render={
                  <Button
                    variant="ghost"
                    className="absolute top-3 right-3 z-10"
                    size="icon-sm"
                  />
                }
              >
                <XIcon />
                <span className="sr-only">Close</span>
              </SheetPrimitive.Close>
            )}
          </>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

/**
 * iOS-style drag-to-dismiss for bottom sheets.
 *
 * The whole content area is a motion.div that drags vertically. Drag is
 * gated by dragControls so it only kicks in from the handle bar — body
 * scrolling stays untouched. Dismiss threshold mirrors iOS: ~120px of
 * downward offset OR a strong downward fling closes it; otherwise the
 * sheet springs back to its resting position.
 */
function BottomSheetDraggable({
  children,
  showHandle,
  showCloseButton,
}: {
  children: React.ReactNode
  showHandle: boolean
  showCloseButton: boolean
}) {
  const y = useMotionValue(0)
  const controls = useDragControls()
  const [dragging, setDragging] = React.useState(false)

  // Lock the body while the sheet is open. iOS Safari ignores plain
  // `overflow: hidden` for touch scrolling, so we save the current
  // scroll Y and pin the body via position:fixed — the standard
  // iOS-PWA scroll-lock trick. On unmount we restore both the inline
  // styles and the scroll position so closing the sheet doesn't
  // shoot the user back to the top of the page.
  //
  // We're careful NOT to interfere with base-ui's modal handling: we
  // only touch body/html style; we don't add any event listeners
  // here.
  React.useEffect(() => {
    const body = document.body
    const html = document.documentElement
    const scrollY = window.scrollY
    const prev = {
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyOverflow: body.style.overflow,
      htmlOverflow: html.style.overflow,
    }
    body.style.position = "fixed"
    body.style.top = `-${scrollY}px`
    body.style.left = "0"
    body.style.right = "0"
    body.style.overflow = "hidden"
    html.style.overflow = "hidden"
    body.dataset.sheetOpen = "true"
    return () => {
      body.style.position = prev.bodyPosition
      body.style.top = prev.bodyTop
      body.style.left = prev.bodyLeft
      body.style.right = prev.bodyRight
      body.style.overflow = prev.bodyOverflow
      html.style.overflow = prev.htmlOverflow
      delete body.dataset.sheetOpen
      window.scrollTo(0, scrollY)
    }
  }, [])

  // Imperatively close by clicking a hidden close button. Keeps base-ui's
  // open state in charge.
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const close = React.useCallback(() => {
    closeRef.current?.click()
  }, [])

  function onDragEnd(_: PointerEvent, info: PanInfo) {
    setDragging(false)
    const past = info.offset.y > 120
    const fling = info.velocity.y > 500
    if (past || fling) {
      close()
      return
    }
    animate(y, 0, { type: "spring", stiffness: 420, damping: 36 })
  }

  // Drag-vs-scroll handoff for inner scrollable lists.
  //
  // When a touch starts inside an inner scroller, we can't tell yet
  // whether the user wants to scroll the list or drag the sheet — we
  // only know once we see the first pointermove. So we defer the
  // decision: arm a one-shot pointermove listener that decides based
  // on the gesture's direction and the scroller's current scrollTop.
  //
  //   - scrollTop > 0  AND any direction: native scroll wins. The
  //     user is somewhere in the middle of the list.
  //   - scrollTop = 0  AND moving DOWN: hand off to the sheet drag —
  //     classic pull-to-close.
  //   - scrollTop = 0  AND moving UP: native scroll wins (no-op since
  //     the list is at the top, but lets iOS render its rubber band
  //     inside the scroller, contained by overscroll-behavior).
  //
  // Touches outside any inner scroller (header, footer pills, the
  // drag handle area) start dragging immediately — no ambiguity
  // there.
  const startDrag = React.useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const scroller = target?.closest<HTMLElement>("[data-sheet-scroll]");
      if (!scroller) {
        controls.start(e);
        return;
      }
      const startScrollTop = scroller.scrollTop;
      const startY = e.clientY;
      // Avoid hijacking gestures that start inside the list while it
      // is already scrolled — the user is mid-list and wants to keep
      // scrolling.
      if (startScrollTop > 0) return;
      // At scrollTop=0, wait for direction. The first move tells us.
      const onMove = (moveEvent: PointerEvent) => {
        const dy = moveEvent.clientY - startY;
        // Need a few px of motion before deciding so a stationary tap
        // doesn't accidentally arm a drag.
        if (Math.abs(dy) < 4) return;
        cleanup();
        if (dy > 0) {
          // Downward at top of list → drag the sheet.
          controls.start(moveEvent as unknown as React.PointerEvent);
        }
        // Upward → do nothing; native scroll handles it.
      };
      const cleanup = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", cleanup);
        document.removeEventListener("pointercancel", cleanup);
      };
      document.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerup", cleanup);
      document.addEventListener("pointercancel", cleanup);
    },
    [controls],
  )

  return (
    <motion.div
      style={{ y, paddingBottom: "env(safe-area-inset-bottom)" }}
      drag="y"
      dragControls={controls}
      dragListener={false}
      dragConstraints={{ top: 0 }}
      dragElastic={{ top: 0.04, bottom: 0 }}
      onDragStart={() => setDragging(true)}
      onDragEnd={onDragEnd}
      transition={{ type: "spring", stiffness: 420, damping: 36 }}
      onPointerDown={startDrag}
      className={cn(
        // Background lives here so the colored container moves with the
        // content during drag — no fixed stripe behind the gesture.
        "relative flex flex-col gap-4 bg-popover bg-clip-padding",
        dragging ? "cursor-grabbing" : "cursor-grab",
      )}
    >
      <SheetPrimitive.Close
        ref={closeRef}
        className="hidden"
        aria-hidden
      />
      {showHandle ? (
        <div
          className="flex w-full shrink-0 select-none items-center justify-center pt-3 pb-1.5"
          aria-hidden
        >
          <span className="h-1 w-9 rounded-full bg-muted-foreground/40 transition-colors hover:bg-muted-foreground/60" />
        </div>
      ) : null}
      {showCloseButton ? (
        <SheetPrimitive.Close
          data-slot="sheet-close"
          render={
            <Button
              variant="ghost"
              className="absolute top-2 right-3 z-20"
              size="icon-sm"
            />
          }
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      ) : null}
      {children}
    </motion.div>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
