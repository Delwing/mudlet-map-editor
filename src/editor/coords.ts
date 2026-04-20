import type { MapRenderer } from 'mudlet-map-renderer';

export function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function clientToMap(
  renderer: MapRenderer,
  container: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = container.getBoundingClientRect();
  const pt = renderer.backend.viewport.clientToMapPoint(clientX, clientY, { left: rect.left, top: rect.top });
  if (pt) return pt;
  // Fallback if scale is zero (before first layout).
  const v = renderer.getViewportBounds();
  return {
    x: v.minX + ((clientX - rect.left) / rect.width) * (v.maxX - v.minX),
    y: v.minY + ((clientY - rect.top) / rect.height) * (v.maxY - v.minY),
  };
}
