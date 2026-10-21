import type { AccessApi } from "../../../contracts/access";

export const DESKTOP_REQUIRED_MESSAGE = "Abre esta pantalla desde la aplicación de escritorio.";

function isAccessApi(value: unknown): value is AccessApi {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AccessApi>;
  return Boolean(
    candidate.auth &&
      typeof candidate.auth.status === "function" &&
      typeof candidate.auth.bootstrap === "function" &&
      typeof candidate.auth.login === "function" &&
      typeof candidate.auth.logout === "function" &&
      typeof candidate.auth.me === "function" &&
      typeof candidate.auth.touch === "function" &&
      typeof candidate.auth.changePassword === "function" &&
      typeof candidate.auth.recover === "function" &&
      typeof candidate.auth.rotateRecoveryKey === "function" &&
      candidate.users &&
      typeof candidate.users.list === "function" &&
      typeof candidate.users.create === "function" &&
      typeof candidate.users.update === "function" &&
      typeof candidate.users.disable === "function" &&
      candidate.roles &&
      typeof candidate.roles.list === "function" &&
      typeof candidate.roles.assign === "function" &&
      candidate.audit &&
      typeof candidate.audit.list === "function",
  );
}

export function getAccessApi(): AccessApi | null {
  if (typeof window === "undefined" || !window.panel) return null;
  const candidate = window.panel as unknown as AccessApi;
  return isAccessApi(candidate) ? candidate : null;
}
