// Cross-platform native window placement, wrapping node-window-manager.
//
// node-window-manager is a native addon. If it fails to load (missing/incompatible binding on an
// unusual setup) we degrade gracefully: window management becomes a no-op and the app still runs.
// On macOS it drives the Accessibility API, so the app (or the terminal running it in dev) must be
// granted Accessibility permission under System Settings -> Privacy & Security -> Accessibility.
// Without that grant these calls silently no-op. Every entry point below is defensive.

import type { Window } from 'node-window-manager';
import { Bounds, WorkArea, computeTileBounds } from './tiling';

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// Load the native module tolerantly — a broken binding must not crash app startup.
let windowManager: typeof import('node-window-manager').windowManager | null = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    windowManager = require('node-window-manager').windowManager;
} catch (e) {
    console.warn(`node-window-manager unavailable; window tiling disabled: ${(e as Error).message}`);
}

/** True when native window management loaded successfully. */
export function windowManagementAvailable(): boolean {
    return windowManager !== null;
}

/**
 * On macOS, ask for the Accessibility grant that window moving requires (this triggers the system
 * prompt on first run) and report whether it is granted. No-op / true elsewhere.
 */
export function ensureAccessibilityGrant(): boolean {
    if (!isMac || !windowManager) return true;
    try {
        const wm = windowManager as unknown as { requestAccessibility?: () => boolean };
        if (typeof wm.requestAccessibility === 'function') {
            return wm.requestAccessibility();
        }
    } catch (e) {
        console.warn(`requestAccessibility failed: ${(e as Error).message}`);
    }
    return false;
}

/**
 * node-window-manager's win32 setBounds multiplies the given coordinates by the scale factor of the
 * monitor the window is currently on. Electron hands us DIP coordinates, so on Windows we must divide
 * by that scale factor to land in the right place on a HiDPI display. Elsewhere the bounds pass
 * through unchanged.
 */
function toNativeBounds(bounds: Bounds, scaleFactor?: number): Bounds {
    if (!isWindows || !scaleFactor || scaleFactor === 1) return bounds;
    return {
        x: Math.round(bounds.x / scaleFactor),
        y: Math.round(bounds.y / scaleFactor),
        width: Math.round(bounds.width / scaleFactor),
        height: Math.round(bounds.height / scaleFactor),
    };
}

function safeTitle(win: Window): string {
    try {
        return win.getTitle() ?? '';
    } catch {
        return '';
    }
}

/**
 * Find the main native window belonging to a process id.
 * On Windows we require a visible, titled window. On macOS `isVisible()` is unreliable, so we
 * match on a non-empty title only and fall back to the first window for the pid.
 */
export function findWindowByPid(pid: number): Window | undefined {
    if (!windowManager) return undefined;
    const filtered = windowManager.getWindows().filter((w) => w.processId === pid);
    const titled = filtered.filter((w) => safeTitle(w).length > 0);

    if (isWindows) {
        const visible = titled.find((w) => {
            try {
                return w.isVisible();
            } catch {
                return true;
            }
        });
        return visible ?? titled[0];
    }
    return titled[0] ?? filtered[0];
}

/**
 * Move/resize a process's window. Returns true only if the window was actually repositioned.
 *
 * On macOS, node-window-manager moves windows through the Accessibility API, which silently no-ops
 * without the user's grant — while still *finding* the window. We therefore read the bounds back and
 * confirm the move took, so callers (and the UI's "grant Accessibility" warning) reflect reality
 * rather than reporting success on a window that never moved.
 */
export function setWindowBounds(pid: number, bounds: Bounds, scaleFactor?: number): boolean {
    try {
        const win = findWindowByPid(pid);
        if (!win) return false;
        win.setBounds(toNativeBounds(bounds, scaleFactor));

        if (isMac) {
            try {
                const after = win.getBounds();
                if (after && typeof after.x === 'number' && typeof after.y === 'number') {
                    const moved = Math.abs(after.x - bounds.x) <= 4 && Math.abs(after.y - bounds.y) <= 4;
                    return moved;
                }
            } catch {
                // Can't read back — assume the move worked rather than warn spuriously.
                return true;
            }
        }
        return true;
    } catch (e) {
        console.warn(`setWindowBounds failed for PID ${pid}: ${(e as Error).message}`);
        return false;
    }
}

export function restoreWindow(pid: number): void {
    try {
        findWindowByPid(pid)?.restore();
    } catch (e) {
        console.warn(`restoreWindow failed for PID ${pid}: ${(e as Error).message}`);
    }
}

export function minimizeWindow(pid: number): void {
    try {
        findWindowByPid(pid)?.minimize();
    } catch (e) {
        console.warn(`minimizeWindow failed for PID ${pid}: ${(e as Error).message}`);
    }
}

/** Tile the given process windows into a grid within `workArea`. Returns how many were placed. */
export function tileWindows(pids: number[], workArea: WorkArea, scaleFactor?: number): number {
    let placed = 0;
    pids.forEach((pid, index) => {
        const bounds = computeTileBounds(index, pids.length, workArea);
        if (setWindowBounds(pid, bounds, scaleFactor)) placed++;
    });
    return placed;
}

/** True on platforms where window control depends on a user permission grant (macOS). */
export function requiresAccessibilityGrant(): boolean {
    return isMac;
}
