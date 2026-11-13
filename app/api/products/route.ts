import { handle } from "@/lib/apiHandler";
import { searchProducts } from "@/lib/magento";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  return searchProducts({
    q: sp.get("q") ?? undefined,
    page: Number(sp.get("page")) || 1,
    pageSize: Number(sp.get("pageSize")) || 25,
  });
});
