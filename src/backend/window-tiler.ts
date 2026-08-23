// Cross-platform native window placement, wrapping node-window-manager.
//
// node-window-manager supports both Windows and macOS. On macOS it drives the Accessibility
// API, so the app (or the terminal running it in dev) must be granted Accessibility permission
// under System Settings -> Privacy & Security -> Accessibility. Without that grant these calls
// silently no-op; every entry point below is defensive and returns/logs rather than throwing.

import { windowManager, Window } from 'node-window-manager';
import { Bounds, WorkArea, computeTileBounds } from './tiling';

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

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

/** Move/resize a process's window. Returns true if a window was found and positioned. */
export function setWindowBounds(pid: number, bounds: Bounds): boolean {
    try {
        const win = findWindowByPid(pid);
        if (!win) return false;
        win.setBounds(bounds);
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
export function tileWindows(pids: number[], workArea: WorkArea): number {
    let placed = 0;
    pids.forEach((pid, index) => {
        const bounds = computeTileBounds(index, pids.length, workArea);
        if (setWindowBounds(pid, bounds)) placed++;
    });
    return placed;
}

/** True on platforms where window control depends on a user permission grant (macOS). */
export function requiresAccessibilityGrant(): boolean {
    return isMac;
}
