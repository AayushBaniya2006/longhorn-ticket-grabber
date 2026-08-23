import { ipcRenderer, IpcRendererEvent } from 'electron';
import { contextBridge } from 'electron';
import { MainToRendererChannels, MainToRendererPayloads, RendererToMainChannels, RendererToMainPayloads, RequestResponseChannels, RequestResponsePayloads } from './api-channels';

const listenersMap = new Map();

function wrapCallback<T extends MainToRendererChannels>(func: (data: MainToRendererPayloads[T]) => void) {
    return func;
}

export const api = {
    send: <T extends RendererToMainChannels>(channel: T, data?: RendererToMainPayloads[T]) => {
        if (!Object.values(RendererToMainChannels).includes(channel)) return;
        ipcRenderer.send(channel, data);
    },
    receive: <T extends MainToRendererChannels>(channel: T, func: (data: MainToRendererPayloads[T]) => void) => {
        if (!Object.values(MainToRendererChannels).includes(channel)) return;
        const subscription = (event: IpcRendererEvent, ...args: any) => wrapCallback(func)(args[0]);

        // Store the subscription in the map for easy removal later
        listenersMap.set(channel, subscription);

        ipcRenderer.on(channel, subscription);
        return () => {
            ipcRenderer.removeListener(channel, subscription);
        }
    },
    request: <T extends RequestResponseChannels>(channel: T, data: RequestResponsePayloads[T]["REQUEST"]) => {
        if (!Object.values(RequestResponseChannels).includes(channel)) return;
        return ipcRenderer.invoke(channel, data) as Promise<RequestResponsePayloads[T]["RESPONSE"]>;
    },
    remove: <T extends MainToRendererChannels>(channel: T) => {
        const subscription = listenersMap.get(channel);
        if (subscription) {
            ipcRenderer.removeListener(channel, subscription);
            listenersMap.delete(channel);
        }
    },
    channels: {
        RendererToMainChannels,
        MainToRendererChannels,
        RequestResponseChannels
    }
}

contextBridge.exposeInMainWorld(
    "api", api
);