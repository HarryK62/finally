/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk, 2000).
 *
 * Hand-rolled rather than pulled from a chart library because the heatmap needs
 * pixel-exact control: 2px gutters between cells, and labels that appear only
 * when a cell is actually big enough to hold them.
 */

export interface TreemapInput {
  key: string;
  /** Relative area. Non-positive values are dropped. */
  value: number;
}

export interface TreemapRect {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Node extends TreemapInput {
  area: number;
}

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Worst aspect ratio in a row laid along a side of length `side`. */
function worstRatio(row: Node[], side: number): number {
  if (row.length === 0) return Infinity;
  const sum = row.reduce((total, node) => total + node.area, 0);
  if (sum <= 0 || side <= 0) return Infinity;

  const max = Math.max(...row.map((node) => node.area));
  const min = Math.min(...row.map((node) => node.area));
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/** Place `row` along the short side of `region`; returns the leftover region. */
function layoutRow(row: Node[], region: Region, out: TreemapRect[]): Region {
  const sum = row.reduce((total, node) => total + node.area, 0);
  if (sum <= 0) return region;

  if (region.w >= region.h) {
    const columnWidth = sum / region.h;
    let y = region.y;
    for (const node of row) {
      const height = node.area / columnWidth;
      out.push({ key: node.key, x: region.x, y, w: columnWidth, h: height });
      y += height;
    }
    return { x: region.x + columnWidth, y: region.y, w: region.w - columnWidth, h: region.h };
  }

  const rowHeight = sum / region.w;
  let x = region.x;
  for (const node of row) {
    const width = node.area / rowHeight;
    out.push({ key: node.key, x, y: region.y, w: width, h: rowHeight });
    x += width;
  }
  return { x: region.x, y: region.y + rowHeight, w: region.w, h: region.h - rowHeight };
}

export function squarify(items: TreemapInput[], width: number, height: number): TreemapRect[] {
  const usable = items.filter((item) => Number.isFinite(item.value) && item.value > 0);
  const total = usable.reduce((sum, item) => sum + item.value, 0);
  if (usable.length === 0 || total <= 0 || width <= 0 || height <= 0) return [];

  const sorted = [...usable].sort((a, b) => b.value - a.value);
  const scale = (width * height) / total;
  const nodes: Node[] = sorted.map((item) => ({ ...item, area: item.value * scale }));

  const out: TreemapRect[] = [];
  let region: Region = { x: 0, y: 0, w: width, h: height };
  let row: Node[] = [];

  for (const node of nodes) {
    const side = Math.min(region.w, region.h);
    const candidate = [...row, node];
    // Keep growing the row while doing so does not make its worst cell squatter.
    if (row.length === 0 || worstRatio(candidate, side) <= worstRatio(row, side)) {
      row = candidate;
    } else {
      region = layoutRow(row, region, out);
      row = [node];
    }
  }
  if (row.length > 0) layoutRow(row, region, out);

  return out;
}
