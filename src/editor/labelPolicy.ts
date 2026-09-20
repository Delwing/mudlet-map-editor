/**
 * How the editor's label pixmaps relate to Mudlet's own label rendering.
 *
 * Mudlet draws a label one of two ways (`T2DMap::drawScaledLabel`): if the
 * label has both text and a font family it lays the text out itself at the
 * current zoom, and only otherwise does it draw the pixmap stored in the map.
 * Its own rendering is the crisper of the two at any zoom — but it knows
 * nothing about the styles, borders, padding, text alignment or outlines this
 * editor draws, so for a map that uses those the pixmap is the only faithful
 * version.
 *
 * Which one wins is therefore a choice about the map, not about the editor,
 * and it is left to the consuming app: the defaults below keep Mudlet's
 * behaviour exactly as it has always been, and a plugin opts out via the
 * `labelPolicy()` hook.
 */
export interface LabelPolicy {
  /**
   * Make the editor's pixmap the thing Mudlet draws, by writing
   * `system.labelFont_N` without a font family — the real font travels in
   * `editor.labelFont_N` instead, which Mudlet ignores and this editor reads.
   * Mudlet then fails the `!font.family().isEmpty()` test and scales the
   * pixmap, and since `TMap::serialize` only rewrites that key when the family
   * is non-empty, a save from Mudlet leaves the arrangement intact.
   *
   * Note that dropping the key altogether does *not* have this effect:
   * `TMapLabel::font` is a default-constructed `QFont`, whose family is the
   * application font's — non-empty, so Mudlet re-renders in the wrong font.
   *
   * Default `false`: font and outline colour go to Mudlet's `system.` keys as
   * they always have, and Mudlet renders labels its own way.
   */
  preservePixmaps: boolean;
  /**
   * Factor by which generated pixmaps are rendered larger than their nominal
   * size (`label.size` × `PX_PER_UNIT`). Both Mudlet and this editor's renderer
   * scale the pixmap into the label rect, so a factor above 1 buys sharper text
   * at zoom without changing the label's size on the map — at roughly its
   * square in PNG bytes. Only worth paying where the pixmap is what gets drawn,
   * so it pairs with `preservePixmaps`.
   *
   * `'devicePixelRatio'` (the default) is the historical behaviour, and means
   * the bytes written into a shared map depend on the display scaling of
   * whoever edited it. Any app that cares should pin a number.
   */
  supersample: number | 'devicePixelRatio';
}

export const DEFAULT_LABEL_POLICY: LabelPolicy = {
  preservePixmaps: false,
  supersample: 'devicePixelRatio',
};

let policy: LabelPolicy = DEFAULT_LABEL_POLICY;

/**
 * Publish the plugin-contributed policy. Overrides are merged in plugin order
 * over the defaults, so the last plugin to state a field wins and a plugin that
 * omits one leaves it alone. Called from the app's plugin wiring.
 */
export function registerLabelPolicy(overrides: Partial<LabelPolicy>[]): void {
  policy = overrides.reduce<LabelPolicy>((acc, o) => ({ ...acc, ...o }), DEFAULT_LABEL_POLICY);
}

export function getLabelPolicy(): LabelPolicy {
  return policy;
}

/** `supersample` as a usable factor, with `'devicePixelRatio'` read off the display. */
export function resolveSupersample(): number {
  const { supersample } = policy;
  if (supersample === 'devicePixelRatio') return window.devicePixelRatio || 1;
  return supersample > 0 ? supersample : 1;
}
