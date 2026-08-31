export enum RendererToMainChannels {
    SPAWN_SESSION = "SPAWN_SESSION",
    SESSION_READY = "SESSION_READY",
    START_MONITORING = "START_MONITORING",
    MARK_SESSION_PROCESSED = "MARK_SESSION_PROCESSED"
}

export interface RendererToMainPayloads {
    [RendererToMainChannels.SPAWN_SESSION]: {
        url: string;
        selector: string;
    };
    [RendererToMainChannels.SESSION_READY]: {};
    [RendererToMainChannels.START_MONITORING]: {
        sessionId: string;
    };
    [RendererToMainChannels.MARK_SESSION_PROCESSED]: {
        sessionId: string;
    };
};

export enum MainToRendererChannels {
    SESSION_TRIGGERED = "SESSION_TRIGGERED",
    SESSION_PROCESSING = "SESSION_PROCESSING"
}

export interface MainToRendererPayloads {
    [MainToRendererChannels.SESSION_TRIGGERED]: {
        sessionId: string;
    };
    [MainToRendererChannels.SESSION_PROCESSING]: {
        sessionId: string;
    };
}


export enum RequestResponseChannels {
    SPAWN_SESSION = "SPAWN_SESSION",
    SESSION_READY = "SESSION_READY",
    SAVE_CREDENTIALS = "SAVE_CREDENTIALS",
    LOAD_CREDENTIALS = "LOAD_CREDENTIALS"
}

export interface RequestResponsePayloads {
    [RequestResponseChannels.SPAWN_SESSION]: {
        REQUEST : {
            url: string;
            selector: string;
            eid?: string;
            password?: string;
        },
        RESPONSE: Promise<{
            success: boolean;
            sessionId?: string;
            error?: string;
        }>;
    },
    [RequestResponseChannels.SESSION_READY]: {
        REQUEST: {
            sessionId: string;
        },
        RESPONSE: Promise<{
            success: boolean;
            error?: string;
            warning?: string;
        }>;
    },
    [RequestResponseChannels.SAVE_CREDENTIALS]: {
        REQUEST: {
            eid: string;
            password: string;
            remember: boolean;
        },
        RESPONSE: Promise<{
            success: boolean;
            error?: string;
        }>;
    },
    [RequestResponseChannels.LOAD_CREDENTIALS]: {
        REQUEST: {};
        RESPONSE: Promise<{
            eid: string;
            remembered: boolean;
            // Whether a password is stored on this device. The password itself is never sent to the
            // renderer — the main process reads it directly when spawning a session.
            hasPassword: boolean;
        }>;
    }
}