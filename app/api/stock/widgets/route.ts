import { NextResponse } from "next/server";
import { deleteWidget, listWidgets, parseWidgetInput, saveWidget, widgetsEnabled, WidgetInputError } from "@/lib/stockWidgets";
import { getSessionUser } from "@/lib/sessionUser";
import { MagentoError } from "@/lib/magento";

export const dynamic = "force-dynamic";

const fail = (e: unknown) =>
  e instanceof WidgetInputError
    ? NextResponse.json({ error: e.message }, { status: 400 })
    : e instanceof MagentoError
      ? NextResponse.json({ error: e.message }, { status: e.status === 401 ? 403 : e.status >= 400 && e.status < 600 ? e.status : 502 })
      : (console.error(e), NextResponse.json({ error: "No se pudieron guardar los contadores." }, { status: 500 }));

export async function GET() {
  if (!widgetsEnabled()) return NextResponse.json({ enabled: false, widgets: [] });
  try {
    return NextResponse.json({ enabled: true, widgets: await listWidgets() });
  } catch (e) {
    return fail(e);
  }
}

/** Crea o actualiza el contador de un SKU. */
export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  try {
    const input = parseWidgetInput(await req.json().catch(() => null));
    return NextResponse.json({ widget: await saveWidget(input, user) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  const sku = new URL(req.url).searchParams.get("sku");
  if (!sku) return NextResponse.json({ error: "Falta sku" }, { status: 400 });
  try {
    await deleteWidget(sku);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
