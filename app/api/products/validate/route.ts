import { BadRequest, handle } from "@/lib/apiHandler";
import { findExistingSkus } from "@/lib/magento";

// Recibe { skus: string[] } y devuelve { existing: string[] } con la grafía de Magento.
export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as { skus?: unknown } | null;
  if (!body || !Array.isArray(body.skus) || body.skus.some((s) => typeof s !== "string")) {
    throw new BadRequest("Se esperaba { skus: string[] }");
  }
  if (body.skus.length > 5000) throw new BadRequest("Máximo 5000 SKU por validación");
  return { existing: await findExistingSkus(body.skus as string[]) };
});
