import type { SceneOverlay, SceneOverlayContext, Shape, RectShape } from 'mudlet-map-renderer';
import type { MudletMap } from '../../mapIO';
import type { MapDiff } from './mapDiff';

export type DiffStatus = 'added' | 'deleted' | 'changed';

/** Stable keys shared between the sidebar entries and the pane highlights. */
export const roomKey = (status: DiffStatus, id: number): string =>
  `r${status === 'added' ? '+' : status === 'deleted' ? '-' : '~'}${id}`;
export const labelKey = (status: DiffStatus, areaId: number, labelId: number): string =>
  `l${status[0]}${areaId}-${labelId}`;

/** A room/label to tint, in renderer world space (renderY = -rawY). */
export interface DiffHighlight {
  key: string;
  renderX: number;
  renderY: number;
  z: number;
  area: number;
  status: DiffStatus;
  /** Half-extents of the rect in world units (room half-size, or label w/2 & h/2). */
  halfX: number;
  halfY: number;
}

const STATUS_STYLE: Record<DiffStatus, { stroke: string; fill: string }> = {
  added: { stroke: '#36d399', fill: 'rgba(54, 211, 153, 0.20)' },
  deleted: { stroke: '#f87272', fill: 'rgba(248, 114, 114, 0.20)' },
  changed: { stroke: '#fbbd23', fill: 'rgba(251, 189, 35, 0.18)' },
};

/**
 * A {@link SceneOverlay} that tints changed rooms/labels for the currently
 * displayed area + z-level. Filtering by view keeps each pane in sync with its
 * `drawArea(area, z)` call.
 */
export class DiffHighlightOverlay implements SceneOverlay {
  private ctx?: SceneOverlayContext;
  private area = -1;
  private z = 0;
  private enabled = true;
  private hoverKey: string | null = null;

  constructor(private readonly highlights: DiffHighlight[]) {}

  attach(ctx: SceneOverlayContext): void {
    this.ctx = ctx;
  }

  detach(): void {
    this.ctx = undefined;
  }

  setView(area: number, z: number): void {
    this.area = area;
    this.z = z;
    this.ctx?.invalidate();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.ctx?.invalidate();
  }

  setHoverKey(key: string | null): void {
    if (this.hoverKey === key) return;
    this.hoverKey = key;
    this.ctx?.invalidate();
  }

  render(): Shape | Shape[] | void {
    const pad = 0.18;
    const shapes: RectShape[] = [];
    for (const h of this.highlights) {
      if (h.area !== this.area || h.z !== this.z) continue;
      const isHovered = h.key === this.hoverKey;
      // Tints are optional; the hovered change is always drawn for emphasis.
      if (!this.enabled && !isHovered) continue;
      const style = STATUS_STYLE[h.status];
      shapes.push({
        type: 'rect',
        layer: 'overlay',
        x: h.renderX - h.halfX - pad,
        y: h.renderY - h.halfY - pad,
        width: (h.halfX + pad) * 2,
        height: (h.halfY + pad) * 2,
        cornerRadius: 0.08,
        paint: {
          fill: style.fill,
          stroke: style.stroke,
          strokeWidth: 0.1,
          dash: [0.25, 0.18],
          dashEnabled: true,
        },
      });
      if (isHovered) {
        // Bright emphasis ring around the hovered change.
        const hpad = pad + 0.22;
        shapes.push({
          type: 'rect',
          layer: 'overlay',
          x: h.renderX - h.halfX - hpad,
          y: h.renderY - h.halfY - hpad,
          width: (h.halfX + hpad) * 2,
          height: (h.halfY + hpad) * 2,
          cornerRadius: 0.12,
          paint: {
            stroke: '#ffffff',
            strokeWidth: 0.16,
          },
        });
      }
    }
    return shapes;
  }
}

/**
 * Build the highlight list for one side of the diff.
 *
 * @param diff   the computed diff (v1 = old / left, v2 = new / right)
 * @param map    the map shown on this side (used to resolve coords of changed rooms/labels)
 * @param side   'old' shows deletions + changes, 'new' shows additions + changes
 * @param roomSize  renderer room size (world units)
 */
export function collectHighlights(
  diff: MapDiff,
  map: MudletMap,
  side: 'old' | 'new',
  roomSize: number,
): DiffHighlight[] {
  const out: DiffHighlight[] = [];
  const roomHalf = roomSize / 2;

  // Added rooms live only in the new map; deleted only in the old map.
  if (side === 'new') {
    for (const r of diff.rooms.added) {
      out.push({ key: roomKey('added', r.id), renderX: r.x, renderY: -r.y, z: r.z, area: r.area, status: 'added', halfX: roomHalf, halfY: roomHalf });
    }
  } else {
    for (const r of diff.rooms.deleted) {
      out.push({ key: roomKey('deleted', r.id), renderX: r.x, renderY: -r.y, z: r.z, area: r.area, status: 'deleted', halfX: roomHalf, halfY: roomHalf });
    }
  }

  // Changed rooms exist in both maps; resolve coords from this side's map.
  for (const id of Object.keys(diff.rooms.updated)) {
    const room = map.rooms[Number(id)];
    if (!room) continue;
    out.push({ key: roomKey('changed', Number(id)), renderX: room.x, renderY: -room.y, z: room.z, area: room.area, status: 'changed', halfX: roomHalf, halfY: roomHalf });
  }

  // Labels: pos is [x, y, z]; size is [w, h] in world units.
  const labelHighlight = (l: { pos: [number, number, number]; size: [number, number]; areaId: number }, status: DiffStatus, labelId: number) => {
    const [lx, ly, lz] = l.pos;
    const [w, h] = l.size;
    // The renderer draws labels with their top-left corner at (X, -Y) and the
    // rect extending *down* by Height. So only the corner Y is negated; the
    // half-height is then added in render space, not negated with it.
    out.push({ key: labelKey(status, l.areaId, labelId), renderX: lx + w / 2, renderY: -ly + h / 2, z: lz, area: l.areaId, status, halfX: w / 2, halfY: h / 2 });
  };

  if (side === 'new') {
    for (const l of diff.labels.added) labelHighlight(l as any, 'added', (l as any).labelId ?? l.id);
  } else {
    for (const l of diff.labels.deleted) labelHighlight(l as any, 'deleted', (l as any).labelId ?? l.id);
  }
  for (const key of Object.keys(diff.labels.updated)) {
    const [areaIdStr, labelIdStr] = key.split('-');
    const areaId = Number(areaIdStr);
    const labelId = Number(labelIdStr);
    const label = (map.labels[areaId] || []).find((l) => (l.labelId ?? l.id) === labelId);
    if (label) labelHighlight({ pos: label.pos, size: label.size, areaId }, 'changed', labelId);
  }

  return out;
}
