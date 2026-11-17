import { BadRequest, handle } from "@/lib/apiHandler";
import { repairProductLinks } from "@/lib/magento";

export const maxDuration = 300;

/** Guarda el producto con sus vínculos válidos (quita los que apuntan a SKU borrados). Body: { sku } */
export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as { sku?: unknown } | null;
  if (!body || typeof body.sku !== "string" || !body.sku.trim()) throw new BadRequest("Se esperaba { sku }");
  return repairProductLinks(body.sku.trim());
});
