import { useRef } from "react";

export function PanelResizeHandle({
  side,
  width,
  max,
  label,
  bottom,
  onChange,
}: {
  side: "left" | "right";
  width: number;
  max: number;
  label: string;
  bottom: number;
  onChange: (width: number) => void;
}) {
  const start = useRef({ x: 0, width });
  const change = (value: number) => onChange(Math.max(240, Math.min(max, value)));
  return (
    <hr
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={240}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      // Preflight gives hr a zero height; the grip must span the panel's edges.
      className="pointer-events-auto absolute top-[124px] z-40 m-0 h-auto w-2 touch-none cursor-col-resize rounded-pill border-0 hover:bg-white/20 focus-visible:bg-white/20 focus-visible:outline-none"
      style={{ [side]: width + 16, bottom: bottom + 20 }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        start.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        change(
          start.current.width + (event.clientX - start.current.x) * (side === "left" ? 1 : -1),
        );
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        change(
          event.key === "Home"
            ? 240
            : event.key === "End"
              ? max
              : width + (event.key === "ArrowRight" ? 16 : -16) * (side === "left" ? 1 : -1),
        );
      }}
    />
  );
}
