import type { Result } from "../../../contracts/result";
import type { SystemStatus } from "../../../contracts/system-status";

export type SystemStatusRead = Result<SystemStatus>;

export async function requestSystemStatus(): Promise<SystemStatusRead> {
  if (typeof window === "undefined" || typeof window.panel?.systemStatus !== "function") {
    throw new Error("Abre esta pantalla desde la aplicación de escritorio.");
  }
  return window.panel.systemStatus();
}
