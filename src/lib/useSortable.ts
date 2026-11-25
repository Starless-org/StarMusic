import { animate, useMotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { moveItem } from "./homeLayoutModel";
import { SPRING } from "./motion";

/** How far a press travels before it is a drag and not a tap. */
const SLOP = 6;

/**
 * How much closer another slot has to be before the item takes it. Without it,
 * an item held right between two slots swapped back and forth on every pixel.
 */
const HYSTERESIS = 14;

/**
 * Drag to reorder, for a grid or a list of items of the same size.
 *
 * **The slots are measured once, when the drag starts.** Every item is the same
 * size, so slot `i` is where the item in position `i` sits, whatever that item
 * is. The item under the finger follows it with a transform; the others take
 * their new slots with `layout` (motion), which is a transform too: nothing
 * here animates layout properties, so a drag costs no layout per frame.
 *
 * **Pointer events on the window, not pointer capture.** Reordering moves the
 * dragged element in the DOM, and an element that leaves the document loses
 * its capture: the drag stopped at the first swap.
 *
 * The order is committed once, on release. Saving on every swap would write
 * the file a dozen times for one gesture.
 *
 * Keys move an item too (`onKeyDown`): the arrows step it one place, which is
 * the same reorder without a pointer.
 */
export function useSortable<T extends string>(items: readonly T[], onCommit: (next: T[]) => void) {
  const [order, setOrder] = useState<T[]>([...items]);
  const [dragging, setDragging] = useState<T | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const nodes = useRef(new Map<T, HTMLElement>());
  const active = useRef(false);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  // What comes from outside wins, except in the middle of a drag: the saved
  // layout arriving late must not yank the item out from under the finger.
  const itemsKey = items.join("\u0000");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the content of `items`.
  useEffect(() => {
    if (!active.current) setOrder([...items]);
  }, [itemsKey]);

  const register = useCallback(
    (id: T) => (node: HTMLElement | null) => {
      if (node) nodes.current.set(id, node);
      else nodes.current.delete(id);
    },
    [],
  );

  const onPointerDown = useCallback(
    (id: T) => (event: React.PointerEvent) => {
      if (event.button !== 0 || active.current) return;
      const start = order.indexOf(id);
      if (start < 0) return;
      const slots = order.map((item) => nodes.current.get(item)?.getBoundingClientRect() ?? null);
      if (slots.some((slot) => slot === null)) return;
      const rects = slots as DOMRect[];
      const from = { x: event.clientX, y: event.clientY };
      let local = [...order];
      let current = start;
      let started = false;

      const move = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - from.x;
        const dy = moveEvent.clientY - from.y;
        if (!started) {
          if (Math.hypot(dx, dy) < SLOP) return;
          started = true;
          active.current = true;
          setDragging(id);
        }
        moveEvent.preventDefault();
        const centre = {
          x: rects[start].left + rects[start].width / 2 + dx,
          y: rects[start].top + rects[start].height / 2 + dy,
        };
        const away = (rect: DOMRect) =>
          Math.hypot(rect.left + rect.width / 2 - centre.x, rect.top + rect.height / 2 - centre.y);
        let nearest = current;
        let best = away(rects[current]) - HYSTERESIS;
        rects.forEach((rect, index) => {
          const distance = away(rect);
          if (distance < best) {
            best = distance;
            nearest = index;
          }
        });
        if (nearest !== current) {
          local = moveItem(local, current, nearest);
          current = nearest;
          // **The swap and the new offset land in the same frame.** A plain
          // `setOrder` moved the element in the DOM a frame after its offset
          // was set for the new slot: for that frame it sat in the new slot
          // with the old offset, and every swap jumped. `flushSync` renders the
          // swap now, inside the event, and the offset below is for the DOM
          // as it is.
          flushSync(() => setOrder(local));
        }
        x.set(rects[start].left + dx - rects[current].left);
        y.set(rects[start].top + dy - rects[current].top);
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (!started) return;
        const changed = local.some((item, index) => item !== order[index]);
        void Promise.all([animate(x, 0, SPRING), animate(y, 0, SPRING)]).then(() => {
          active.current = false;
          setDragging(null);
        });
        if (changed) commit.current(local);
      };

      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [order, x, y],
  );

  const onKeyDown = useCallback(
    (id: T) => (event: React.KeyboardEvent) => {
      const step =
        event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : event.key === "ArrowRight" || event.key === "ArrowDown"
            ? 1
            : 0;
      if (step === 0) return;
      const from = order.indexOf(id);
      const to = from + step;
      if (from < 0 || to < 0 || to >= order.length) return;
      event.preventDefault();
      const next = moveItem(order, from, to);
      setOrder(next);
      commit.current(next);
      // The element moves in the DOM; keep the focus on it so the next press
      // moves the same item.
      requestAnimationFrame(() => {
        const node = nodes.current.get(id);
        const handle = node?.querySelector<HTMLElement>('[aria-roledescription="sortable"]');
        (handle ?? node)?.focus();
      });
    },
    [order],
  );

  return { order, dragging, x, y, register, onPointerDown, onKeyDown };
}
