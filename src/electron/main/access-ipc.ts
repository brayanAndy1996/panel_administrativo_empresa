import type { AccessOperation } from "../../contracts/access";
import { randomUUID } from "node:crypto";
import { failure, type Result } from "../../contracts/result";
import type { AccessExecution } from "../../backend/modules/access/service";
import { isAuthorizedIpcEvent, type IpcEventLike, type WebContentsLike } from "./security";
export interface AccessBridgeOptions {
  getExpectedContents(): WebContentsLike | null;
  execute(operation: AccessOperation, input?: unknown, sessionId?: string | null): Promise<AccessExecution>;
}
export function createAccessBridge(options: AccessBridgeOptions) {
  let token: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;
  const noInput = new Set<AccessOperation>(["auth.status", "auth.logout", "auth.me", "auth.touch", "roles.list"]);
  return {
    async handle(operation: AccessOperation, event: IpcEventLike, ...args: unknown[]): Promise<Result<unknown>> {
      const requestId = randomUUID();
      if (disposed || !isAuthorizedIpcEvent(event, options.getExpectedContents())) return failure("FORBIDDEN", "La solicitud no está autorizada.", requestId);
      if (args.length > 1 || (noInput.has(operation) && args.length > 0)) return failure("VALIDATION_ERROR", "La solicitud no es válida.", requestId);
      const task = queue.catch(() => undefined).then(async () => {
        if (disposed || !isAuthorizedIpcEvent(event, options.getExpectedContents())) return failure("FORBIDDEN", "La solicitud no está autorizada.", requestId);
        try {
          const reply = await options.execute(operation, args[0], token);
          if (reply.sessionId !== undefined) token = reply.sessionId;
          return reply.result;
        } catch { return failure("INTERNAL_ERROR", "No se pudo completar la operación local.", requestId); }
      });
      queue = task; return task;
    },
    async dispose(): Promise<void> {
      disposed = true;
      await queue.catch(() => undefined);
      const previousToken = token; token = null;
      if (previousToken) await options.execute("auth.logout", undefined, previousToken);
    },
  };
}
