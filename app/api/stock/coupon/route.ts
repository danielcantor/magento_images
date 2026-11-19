import { handle, BadRequest } from "@/lib/apiHandler";
import { checkCoupon } from "@/lib/coupons";

export const dynamic = "force-dynamic";

/** ¿Existe el cupón en Magento y está vigente? (con el usuario conectado). */
export const GET = handle(async (req: Request) => {
  const code = (new URL(req.url).searchParams.get("code") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) throw new BadRequest("Cupón no válido");
  return checkCoupon(code);
});
