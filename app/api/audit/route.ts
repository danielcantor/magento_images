import { NextResponse } from "next/server";
import { AuditError, isAuditEnabled, listAudit, startAudit, type AuditFinishInput, type AuditStartInput } from "@/lib/audit";
import { getSessionUser } from "@/lib/sessionUser";

export const dynamic = "force-dynamic";

const fail = (e: unknown) =>
  e instanceof AuditError
    ? NextResponse.json({ error: e.message }, { status: e.status })
    : (console.error(e), NextResponse.json({ error: "No se pudo usar el registro de acciones." }, { status: 500 }));

/** Acciones del usuario de la sesión. ?cursor=&kind= */
export async function GET(req: Request) {
  if (!isAuditEnabled()) return NextResponse.json({ enabled: false, items: [] });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  try {
    const r = await listAudit(user, { cursor: sp.get("cursor") || undefined, kind: sp.get("kind") || undefined });
    return NextResponse.json({ enabled: true, ...r });
  } catch (e) {
    return fail(e);
  }
}

/** Crea un registro: { kind, params?, skus?, total?, finish? } — con `finish` queda cerrado. */
export async function POST(req: Request) {
  if (!isAuditEnabled()) return NextResponse.json({ enabled: false });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as (AuditStartInput & { finish?: AuditFinishInput }) | null;
  if (!body || typeof body.kind !== "string") return NextResponse.json({ error: "Falta kind" }, { status: 400 });
  try {
    const rec = await startAudit(user, body, body.finish);
    return NextResponse.json({ enabled: true, id: rec.id });
  } catch (e) {
    return fail(e);
  }
}
