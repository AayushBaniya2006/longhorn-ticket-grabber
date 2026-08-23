import { api } from "backend/preload";

declare global {
    interface Window {
        api: typeof api;
    }
}

export {};