import { NextResponse } from "next/server";
import { AuditError, finishAudit, getAudit, type AuditFinishInput } from "@/lib/audit";
import { getSessionUser } from "@/lib/sessionUser";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const fail = (e: unknown) =>
  e instanceof AuditError
    ? NextResponse.json({ error: e.message }, { status: e.status })
    : (console.error(e), NextResponse.json({ error: "No se pudo usar el registro de acciones." }, { status: 500 }));

/** Detalle; solo si es del usuario de la sesión (si no, 404). */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  try {
    return NextResponse.json(await getAudit(user, (await ctx.params).id));
  } catch (e) {
    return fail(e);
  }
}

/** Cierra un registro en curso: { status, ok, failed, total?, lines } */
export async function PUT(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as AuditFinishInput | null;
  if (!body) return NextResponse.json({ error: "Cuerpo no válido" }, { status: 400 });
  try {
    const rec = await finishAudit(user, (await ctx.params).id, body);
    return NextResponse.json({ ok: true, status: rec.status });
  } catch (e) {
    return fail(e);
  }
}
