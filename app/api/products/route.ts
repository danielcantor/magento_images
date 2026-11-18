import { handle } from "@/lib/apiHandler";
import { searchProducts } from "@/lib/magento";
import { PAGE_SIZES } from "@/lib/types";

export const dynamic = "force-dynamic";

const positiveInt = (v: string | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const size = Number(sp.get("pageSize"));
  const status = Number(sp.get("status"));
  return searchProducts({
    q: sp.get("q") ?? undefined,
    page: positiveInt(sp.get("page")) ?? 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : 25,
    status: status === 1 || status === 2 ? status : undefined,
    websiteId: positiveInt(sp.get("website")),
    storeId: positiveInt(sp.get("store")),
    noBase: sp.get("noBase") === "1",
  });
});
