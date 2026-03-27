export interface AuditContext {
  action: string;
  actor: string;
  resource: string;
  callId?: string;
  detail?: string;
}

export function auditLog(context: AuditContext): void {
  const entry: Record<string, string> = {
    timestamp: new Date().toISOString(),
    action: context.action,
    actor: context.actor,
    resource: context.resource,
  };

  if (context.callId !== undefined) {
    entry.callId = context.callId;
  }

  if (context.detail !== undefined) {
    entry.detail = context.detail;
  }

  console.log(`[AUDIT] ${JSON.stringify(entry)}`);
}
