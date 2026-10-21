import { randomUUID } from "node:crypto";
import { failure, type Result } from "../../contracts/result";
import type { SystemStatus } from "../../contracts/system-status";
import { isAuthorizedIpcEvent, type IpcEventLike, type WebContentsLike } from "./security";

interface SystemStatusHandlerOptions {
  getExpectedContents(): WebContentsLike | null;
  getStatus(): Promise<Result<SystemStatus>>;
  createRequestId?: () => string;
}

export function createSystemStatusHandler({
  getExpectedContents,
  getStatus,
  createRequestId = randomUUID,
}: SystemStatusHandlerOptions) {
  return async (event: IpcEventLike, ...args: unknown[]): Promise<Result<SystemStatus>> => {
    const requestId = createRequestId();
    if (!isAuthorizedIpcEvent(event, getExpectedContents())) {
      return failure("FORBIDDEN", "La solicitud no está autorizada.", requestId);
    }
    if (args.length > 0) return failure("VALIDATION_ERROR", "La solicitud no es válida.", requestId);

    try {
      return await getStatus();
    } catch {
      return failure("INTERNAL_ERROR", "No se pudo consultar el estado local.", requestId);
    }
  };
}
