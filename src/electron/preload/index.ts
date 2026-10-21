import { contextBridge, ipcRenderer } from "electron";
import { SYSTEM_STATUS_CHANNEL, type PanelApi } from "../../contracts/ipc";

const panelApi: PanelApi = Object.freeze({
  systemStatus: () => ipcRenderer.invoke(SYSTEM_STATUS_CHANNEL),
  auth: Object.freeze({
    status: () => ipcRenderer.invoke("panel:auth.status"),
    bootstrap: (input: Parameters<PanelApi["auth"]["bootstrap"]>[0]) => ipcRenderer.invoke("panel:auth.bootstrap", input),
    login: (input: Parameters<PanelApi["auth"]["login"]>[0]) => ipcRenderer.invoke("panel:auth.login", input),
    logout: () => ipcRenderer.invoke("panel:auth.logout"),
    me: () => ipcRenderer.invoke("panel:auth.me"),
    touch: () => ipcRenderer.invoke("panel:auth.touch"),
    changePassword: (input: Parameters<PanelApi["auth"]["changePassword"]>[0]) => ipcRenderer.invoke("panel:auth.changePassword", input),
    recover: (input: Parameters<PanelApi["auth"]["recover"]>[0]) => ipcRenderer.invoke("panel:auth.recover", input),
    rotateRecoveryKey: (input: Parameters<PanelApi["auth"]["rotateRecoveryKey"]>[0]) => ipcRenderer.invoke("panel:auth.rotateRecoveryKey", input),
  }),
  users: Object.freeze({
    list: (input?: Parameters<PanelApi["users"]["list"]>[0]) => ipcRenderer.invoke("panel:users.list", input),
    create: (input: Parameters<PanelApi["users"]["create"]>[0]) => ipcRenderer.invoke("panel:users.create", input),
    update: (input: Parameters<PanelApi["users"]["update"]>[0]) => ipcRenderer.invoke("panel:users.update", input),
    disable: (input: Parameters<PanelApi["users"]["disable"]>[0]) => ipcRenderer.invoke("panel:users.disable", input),
  }),
  roles: Object.freeze({
    list: () => ipcRenderer.invoke("panel:roles.list"),
    assign: (input: Parameters<PanelApi["roles"]["assign"]>[0]) => ipcRenderer.invoke("panel:roles.assign", input),
  }),
  audit: Object.freeze({ list: (input?: Parameters<PanelApi["audit"]["list"]>[0]) => ipcRenderer.invoke("panel:audit.list", input) }),
});

contextBridge.exposeInMainWorld("panel", panelApi);
