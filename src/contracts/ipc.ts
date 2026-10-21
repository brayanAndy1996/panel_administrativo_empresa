import type { AccessApi } from "./access";
export const SYSTEM_STATUS_CHANNEL = "panel:system-status" as const;

export interface PanelApi extends AccessApi {
  systemStatus(): Promise<import("./result").Result<import("./system-status").SystemStatus>>;
}
