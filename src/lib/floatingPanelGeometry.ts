export interface PanelSize { width: number; height: number }
export interface PanelBox extends PanelSize { x: number; y: number }
export interface PanelGuides { x?: number; y?: number }
export type PanelResizeMode = 'corner' | 'center';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Changing size preserves the center; containment is a separate operation. */
export function centerPanelSize(box: PanelBox, size: PanelSize): PanelBox {
  return { ...size, x: box.x + (box.width - size.width) / 2, y: box.y + (box.height - size.height) / 2 };
}

export function containPanel(box: PanelBox, area: PanelBox): PanelBox {
  const sized = centerPanelSize(box, {
    width: clamp(box.width, 0, area.width), height: clamp(box.height, 0, area.height),
  });
  return { ...sized,
    x: clamp(sized.x, area.x, area.x + area.width - sized.width),
    y: clamp(sized.y, area.y, area.y + area.height - sized.height),
  };
}

export function snapPanel(box: PanelBox, area: PanelBox, enabled: boolean, threshold = 24): {
  box: PanelBox; guides: PanelGuides;
} {
  const contained = containPanel(box, area);
  const guides: PanelGuides = {};
  if (!enabled) return { box: contained, guides };
  const snapAxis = (position: number, size: number, start: number, length: number) => {
    const targets = [
      { position: start, guide: start },
      { position: start + (length - size) / 2, guide: start + length / 2 },
      { position: start + length - size, guide: start + length },
    ];
    const nearest = targets.reduce((a, b) => Math.abs(b.position - position) < Math.abs(a.position - position) ? b : a);
    return Math.abs(nearest.position - position) <= threshold ? nearest : null;
  };
  const horizontal = snapAxis(contained.x, contained.width, area.x, area.width);
  const vertical = snapAxis(contained.y, contained.height, area.y, area.height);
  if (horizontal) guides.x = horizontal.guide;
  if (vertical) guides.y = vertical.guide;
  return { box: { ...contained, x: horizontal?.position ?? contained.x, y: vertical?.position ?? contained.y }, guides };
}

/** Resize anchors stay fixed during the gesture; containment is applied on release. */
export function resizePanel(box: PanelBox, dx: number, dy: number, fromLeft: boolean, min: PanelSize, area: PanelSize, mode: PanelResizeMode = 'corner'): PanelBox {
  const scale = mode === 'center' ? 2 : 1;
  const width = clamp(box.width + dx * (fromLeft ? -scale : scale), Math.min(min.width, area.width), area.width);
  const height = clamp(box.height + dy * scale, Math.min(min.height, area.height), area.height);
  return mode === 'center'
    ? centerPanelSize(box, { width, height })
    : { x: fromLeft ? box.x + box.width - width : box.x, y: box.y, width, height };
}

export function validPanelPosition(value: unknown): value is { x: number; y: number } {
  return !!value && typeof value === 'object'
    && 'x' in value && Number.isFinite(value.x) && 'y' in value && Number.isFinite(value.y);
}

export function validPanelBox(value: unknown): value is PanelBox {
  return validPanelPosition(value) && 'width' in value && typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0
    && 'height' in value && typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0;
}
