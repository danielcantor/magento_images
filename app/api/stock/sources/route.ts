import { handle, BadRequest } from "@/lib/apiHandler";
import { getSourceItemsMany } from "@/lib/stock";

export const dynamic = "force-dynamic";

/** Unidades por fuente de varios SKU (?skus=a,b,c), para crear contadores en lote. */
export const GET = handle(async (req: Request) => {
  const skus = [...new Set((new URL(req.url).searchParams.get("skus") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (!skus.length) throw new BadRequest("Faltan SKU");
  if (skus.length > 200) throw new BadRequest("Máximo 200 SKU por consulta");
  return { items: await getSourceItemsMany(skus) };
});
