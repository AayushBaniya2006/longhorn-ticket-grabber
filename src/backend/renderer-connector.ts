import { BrowserWindow } from "electron";
import { MainToRendererChannels, MainToRendererPayloads, RendererToMainChannels, RendererToMainPayloads, RequestResponseChannels, RequestResponsePayloads } from "./api-channels";
import { ipcMain } from "electron";


export default class RendererConnector {

    private browserWindow: BrowserWindow | null = null;

    constructor(mainWindow: BrowserWindow) {
        this.browserWindow = mainWindow;
    }

    /** Point the connector at a (re)created window. IPC handlers live on the global ipcMain and are
     *  unaffected — only the target for renderer-bound messages needs updating. */
    public setWindow(mainWindow: BrowserWindow) {
        this.browserWindow = mainWindow;
    }

    public sendToRenderer<T extends MainToRendererChannels>(channel: T, data: MainToRendererPayloads[T]) {
        this.browserWindow?.webContents.send(channel, data);
    }

    public addListener<T extends RendererToMainChannels>(channel: T, listener: (event: Electron.IpcMainEvent, data: RendererToMainPayloads[T]) => void) {
        ipcMain.on(channel, listener);
    }

    public removeListener<T extends RendererToMainChannels>(channel: T, listener: (event: Electron.IpcMainEvent, data: RendererToMainPayloads[T]) => void) {
        ipcMain.removeListener(channel, listener);
    }


    public addRequestHandler<T extends RequestResponseChannels>(channel: T, listener: (event: Electron.IpcMainInvokeEvent, data: RequestResponsePayloads[T]["REQUEST"]) => RequestResponsePayloads[T]["RESPONSE"]) {
        ipcMain.handle(channel, listener);
    }

    public removeRequestHandler<T extends RequestResponseChannels>(channel: T, listener: (event: Electron.IpcMainInvokeEvent, data: RequestResponsePayloads[T]["REQUEST"]) => RequestResponsePayloads[T]["RESPONSE"]) {
        ipcMain.removeHandler(channel);
    }

}