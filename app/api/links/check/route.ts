import { BadRequest, handle } from "@/lib/apiHandler";
import { checkProductLinks } from "@/lib/magento";

export const maxDuration = 300;

/** Revisa los productos vinculados de varios productos (solo lectura). Body: { skus: string[] } (máx. 50). */
export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as { skus?: unknown } | null;
  if (!body || !Array.isArray(body.skus) || !body.skus.length || body.skus.some((s) => typeof s !== "string" || !s.trim())) {
    throw new BadRequest("Se esperaba { skus: string[] }");
  }
  if (body.skus.length > 50) throw new BadRequest("Máximo 50 productos por revisión");
  return { results: await checkProductLinks(body.skus as string[]) };
});
