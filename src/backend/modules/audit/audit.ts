import { randomUUID } from "node:crypto";
import type { AuditEventDto, PageDto } from "../../../contracts/access";
import type { AccessStore } from "../access/store";
export async function appendAudit(store: AccessStore, event: Omit<AuditEventDto, "id">): Promise<void> {
  await store.run("INSERT INTO panel_audit_events(id,occurredAt,actorId,action,targetId,outcome,requestId) VALUES($id,$occurredAt,$actorId,$action,$targetId,$outcome,$requestId)", { id: randomUUID(), ...event });
}
export async function listAudit(store: AccessStore, input: { page: number; pageSize: number; actorId?: unknown; action?: unknown }): Promise<PageDto<AuditEventDto>> {
  const conditions: string[] = []; const bind: Record<string, unknown> = {};
  if (input.actorId) { conditions.push("actorId=$actorId"); bind.actorId = input.actorId; }
  if (input.action) { conditions.push("action=$action"); bind.action = input.action; }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const [row] = await store.rows<{ total: number }>(`SELECT COUNT(*) AS total FROM panel_audit_events${where}`, bind);
  const items = await store.rows<AuditEventDto>(`SELECT id,occurredAt,actorId,action,targetId,outcome,requestId FROM panel_audit_events${where} ORDER BY occurredAt DESC,id DESC LIMIT $limit OFFSET $offset`, { ...bind, limit: input.pageSize, offset: (input.page - 1) * input.pageSize });
  return { items, total: row.total, page: input.page, pageSize: input.pageSize };
}
