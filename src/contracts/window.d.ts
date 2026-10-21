import type { PanelApi } from "./ipc";

declare global {
  interface Window {
    panel?: PanelApi;
  }
}

export {};
