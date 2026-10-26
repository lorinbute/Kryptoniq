// Reordering a watch list by dragging (FD-CHARTFAV §2; one list at a time since FD-WATCHLISTS): the chart's symbol panel
// and the Liste de urmărire page.
// Mouse: drag after 6 px (a plain click still opens the chart). Touch: hold 250 ms, then drag (scrolling still works).
// Keyboard: Alt + arrow on an item moves it one place (dnd-kit's keyboard sensor would take Enter / Space from the chip).
import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { errorMessage } from '../api.ts';
import type { ListReorder } from '../hooks.ts';
import { moveItem } from '../reorder.ts';

/** A row moves only up or down. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

export interface FavoriteOrder {
  /** Moves the favourite `id` by `delta` places (keyboard, arrows). */
  move: (id: string, delta: number) => void;
  /** True right after a drag ended: the click that follows the release must not open anything. */
  justDragged: () => boolean;
  /** Alt + arrow handler for an item; `axis` picks ←/→ (chips) or ↑/↓ (rows). */
  keyMove: (id: string, axis: 'x' | 'y') => (e: React.KeyboardEvent) => void;
}

/**
 * The drag area. `ids` is the whole list in its current order; `reorder` saves a new one (`useReorderList`); `children`
 * gets the helpers. `layout`: 'wrap' for the chips (several rows), 'rows' for the table. `label`: what a screen reader
 * hears for an id (a list's name rather than its number); the id itself by default (a symbol).
 */
export function FavoritesDnd({
  ids,
  layout,
  reorder,
  label = (id) => id,
  children,
}: {
  ids: string[];
  layout: 'wrap' | 'rows';
  reorder: ListReorder;
  label?: (id: string) => string;
  children: (order: FavoriteOrder) => ReactNode;
}) {
  const [live, setLive] = useState('');
  const dragEndedAt = useRef(0);
  // The latest order, also between a move and the next render (several quick Alt + → presses add up).
  const latest = useRef(ids);
  const shown = useRef(ids);
  if (shown.current !== ids) {
    shown.current = ids;
    latest.current = ids;
  }
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));

  const commit = useCallback(
    (id: string, target: (list: string[]) => number) => {
      const list = latest.current;
      const from = list.indexOf(id);
      const to = target(list);
      if (from === to || from < 0 || to < 0 || to >= list.length) return;
      const next = moveItem(list, from, to);
      latest.current = next;
      reorder.save(next);
      setLive(`${label(id)}: poziția ${to + 1} din ${next.length}`);
    },
    [reorder, label],
  );
  const move = useCallback((id: string, delta: number) => commit(id, (list) => list.indexOf(id) + delta), [commit]);
  const onDragEnd = (e: DragEndEvent) => {
    dragEndedAt.current = Date.now();
    const over = e.over;
    if (over) commit(String(e.active.id), (list) => list.indexOf(String(over.id)));
  };
  const keyMove = (id: string, axis: 'x' | 'y') => (e: React.KeyboardEvent) => {
    if (!e.altKey) return;
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== back && e.key !== fwd) return;
    e.preventDefault();
    move(id, e.key === back ? -1 : 1);
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Ai luat ${label(String(active.id))}, poziția ${ids.indexOf(String(active.id)) + 1} din ${ids.length}.`,
    onDragOver: ({ active, over }) => (over ? `${label(String(active.id))} deasupra poziției ${ids.indexOf(String(over.id)) + 1}.` : `${label(String(active.id))} nu e deasupra listei.`),
    onDragEnd: ({ active, over }) => (over ? `${label(String(active.id))} lăsat pe poziția ${ids.indexOf(String(over.id)) + 1}.` : `${label(String(active.id))} a rămas pe loc.`),
    onDragCancel: ({ active }) => `Mutarea lui ${label(String(active.id))} a fost anulată.`,
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      onDragCancel={() => (dragEndedAt.current = Date.now())}
      modifiers={layout === 'rows' ? [verticalOnly] : undefined}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: 'Ca să muți un simbol: trage-l cu mouse-ul sau ține-l apăsat pe ecranul tactil. Cu tastatura: Alt și săgețile.' },
      }}
    >
      <SortableContext items={ids} strategy={layout === 'rows' ? verticalListSortingStrategy : rectSortingStrategy}>
        {children({ move, justDragged: () => Date.now() - dragEndedAt.current < 400, keyMove })}
      </SortableContext>
      <span className="sr-only" aria-live="polite">
        {live}
      </span>
      {reorder.isError && (
        <span role="alert" className="basis-full text-[12.5px] text-bear">
          Ordinea nu s-a salvat: {errorMessage(reorder.error)}
        </span>
      )}
    </DndContext>
  );
}

/** One draggable favourite; `children` gets what to spread on the element (and on its handle). */
export function SortableFavorite({ id, children }: { id: string; children: (s: ReturnType<typeof useSortable> & { style: React.CSSProperties }) => ReactNode }) {
  const s = useSortable({ id, attributes: { roleDescription: 'simbol care se poate muta' } });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(s.transform),
    transition: s.transition,
    // The dragged one stays above the others; the browser's own text selection and touch callouts stay out of the way.
    ...(s.isDragging ? { zIndex: 20, position: 'relative', cursor: 'grabbing' } : {}),
    touchAction: 'manipulation',
  };
  return <>{children({ ...s, style })}</>;
}
