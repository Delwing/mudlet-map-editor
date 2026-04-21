import { store } from './store';
import { TOOLS, type ToolContext } from './tools';
import type { ToolId } from './types';

export function attachPointerController(ctx: ToolContext): () => void {
  const { container } = ctx;
  let consumingPointer: number | null = null;

  const stopAll = (e: Event) => {
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  };

  /** Which tool governs the next pointer event — Space overrides with pan. */
  const effectiveTool = (): ToolId => {
    const s = store.getState();
    return s.spaceHeld ? 'pan' : s.activeTool;
  };

  const shouldActivelyHandle = (ev: PointerEvent) => {
    return !(ev.button !== 0 && ev.type === 'pointerdown');

  };

  const onPointerDown = (ev: PointerEvent) => {
    const s = store.getState();
    const pendingKind = s.pending?.kind;
    const toolId = (pendingKind === 'pickSwatch' || pendingKind === 'pickExit' || pendingKind === 'pickSpecialExit')
      ? 'select'
      : effectiveTool();
    const tool = TOOLS[toolId];
    if (!tool.onPointerDown || !shouldActivelyHandle(ev)) return;
    const consumed = tool.onPointerDown(ev, ctx);
    if (consumed) {
      consumingPointer = ev.pointerId;
      stopAll(ev);
    }
  };

  const onPointerMove = (ev: PointerEvent) => {
    const tool = TOOLS[effectiveTool()];
    const consumed = tool.onPointerMove?.(ev, ctx);
    if (consumed || consumingPointer === ev.pointerId) stopAll(ev);
  };

  const onPointerUp = (ev: PointerEvent) => {
    const tool = TOOLS[effectiveTool()];
    const consumed = tool.onPointerUp?.(ev, ctx);
    const wasCapturing = consumingPointer === ev.pointerId;
    if (wasCapturing) consumingPointer = null;
    if (consumed || wasCapturing) stopAll(ev);
  };

  const onPointerCancel = (ev: PointerEvent) => {
    const tool = TOOLS[effectiveTool()];
    tool.onCancel?.(ctx);
    if (consumingPointer === ev.pointerId) {
      consumingPointer = null;
      stopAll(ev);
    }
  };

  const onPointerLeave = () => {
    if (store.getState().hover) store.setState({ hover: null });
  };

  // Mirror events — the renderer's click/hover handlers are wired on mouse* events.
  // We stop them on the same phases so they don't fire while we're consuming.
  const onMouseDown = (ev: MouseEvent) => {
    if ((ev.button === 0 || ev.button === 2) && effectiveTool() !== 'pan') stopAll(ev);
  };
  const onMouseUp = (ev: MouseEvent) => {
    if ((ev.button === 0 || ev.button === 2) && effectiveTool() !== 'pan') stopAll(ev);
  };
  const onContextMenu = (ev: MouseEvent) => {
    ev.preventDefault();
    const tool = TOOLS[effectiveTool()];
    tool.onContextMenu?.(ev, ctx);
  };

  const opts: AddEventListenerOptions = { capture: true };

  container.addEventListener('pointerdown', onPointerDown, opts);
  container.addEventListener('pointermove', onPointerMove, opts);
  container.addEventListener('pointerup', onPointerUp, opts);
  container.addEventListener('pointercancel', onPointerCancel, opts);
  container.addEventListener('pointerleave', onPointerLeave);
  container.addEventListener('mousedown', onMouseDown, opts);
  container.addEventListener('mouseup', onMouseUp, opts);
  container.addEventListener('contextmenu', onContextMenu);

  return () => {
    container.removeEventListener('pointerdown', onPointerDown, opts);
    container.removeEventListener('pointermove', onPointerMove, opts);
    container.removeEventListener('pointerup', onPointerUp, opts);
    container.removeEventListener('pointercancel', onPointerCancel, opts);
    container.removeEventListener('pointerleave', onPointerLeave);
    container.removeEventListener('mousedown', onMouseDown, opts);
    container.removeEventListener('mouseup', onMouseUp, opts);
    container.removeEventListener('contextmenu', onContextMenu);
  };
}
