// Pure window-tiling geometry. No Electron/Puppeteer imports so this is unit-testable.

export interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A screen work area — same shape as Electron's `Display.workArea`. */
export type WorkArea = Bounds;

/**
 * Columns/rows for a compact, roughly-square grid holding `count` windows.
 * Columns grow first (ceil(sqrt)), rows only as needed — so 5 windows tile 3x2, not 3x3.
 */
export function computeGridDimensions(count: number): { cols: number; rows: number } {
    if (count <= 0) return { cols: 0, rows: 0 };
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    return { cols, rows };
}

/** Bounds for the `index`-th tile in a grid of `count` windows within `workArea`. */
export function computeTileBounds(index: number, count: number, workArea: WorkArea): Bounds {
    const { cols, rows } = computeGridDimensions(count);
    if (cols === 0 || rows === 0) {
        return { ...workArea };
    }
    const tileWidth = Math.floor(workArea.width / cols);
    const tileHeight = Math.floor(workArea.height / rows);
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
        x: workArea.x + col * tileWidth,
        y: workArea.y + row * tileHeight,
        width: tileWidth,
        height: tileHeight,
    };
}

/**
 * Split a work area into a left main-UI pane (fraction of width) and the remaining session pane.
 * Used to keep the HornHub control panel on the left and the active browser session on the right.
 */
export function computeMainSplit(
    workArea: WorkArea,
    mainFraction = 0.3,
): { main: Bounds; session: Bounds } {
    const clamped = Math.min(Math.max(mainFraction, 0), 1);
    const mainWidth = Math.floor(workArea.width * clamped);
    return {
        main: { x: workArea.x, y: workArea.y, width: mainWidth, height: workArea.height },
        session: {
            x: workArea.x + mainWidth,
            y: workArea.y,
            width: workArea.width - mainWidth,
            height: workArea.height,
        },
    };
}
