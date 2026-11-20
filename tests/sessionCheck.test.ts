import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSessionCheckCache, isMagentoSessionValid } from "@/lib/sessionCheck";

const HOURS = 4;
const now = Date.UTC(2026, 10, 20, 12, 0, 0);
/** Sesión emitida hace `ago` ms. */
const session = (ago: number, token = "tok") => ({ token, username: "ana", exp: Math.floor((now - ago) / 1000) + HOURS * 3600 });
const MIN = 60_000;

beforeEach(() => {
  process.env.MAGENTO_BASE_URL = "https://tienda.test/";
  process.env.MAGENTO_STORE_CODE = "all";
  clearSessionCheckCache();
});
afterEach(() => vi.unstubAllGlobals());

const stubFetch = (impl: () => Promise<Response>) => {
  const f = vi.fn(impl);
  vi.stubGlobal("fetch", f);
  return f;
};

describe("isMagentoSessionValid", () => {
  it("token vigente: consulta liviana con el token del usuario", async () => {
    const f = stubFetch(async () => new Response('{"total_count":3}', { status: 200 }));
    expect(await isMagentoSessionValid(session(30 * MIN), HOURS, now)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://tienda.test/rest/all/V1/products?searchCriteria%5BpageSize%5D=1&fields=total_count");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("Magento rechaza el token (401): sesión vencida", async () => {
    stubFetch(async () => new Response("{}", { status: 401 }));
    expect(await isMagentoSessionValid(session(30 * MIN), HOURS, now)).toBe(false);
  });

  it("recién entrado no se consulta (un 401 sería falta de permisos)", async () => {
    const f = stubFetch(async () => new Response("{}", { status: 401 }));
    expect(await isMagentoSessionValid(session(30_000), HOURS, now)).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("Magento caído o con error: no saca a nadie", async () => {
    stubFetch(async () => {
      throw new Error("timeout");
    });
    expect(await isMagentoSessionValid(session(30 * MIN), HOURS, now)).toBe(true);
    stubFetch(async () => new Response("{}", { status: 503 }));
    expect(await isMagentoSessionValid(session(30 * MIN), HOURS, now)).toBe(true);
  });

  it("guarda el resultado 1 minuto por token", async () => {
    const f = stubFetch(async () => new Response("{}", { status: 401 }));
    expect(await isMagentoSessionValid(session(30 * MIN), HOURS, now)).toBe(false);
    expect(await isMagentoSessionValid(session(30 * MIN), HOURS, now + 50_000)).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    await isMagentoSessionValid(session(30 * MIN), HOURS, now + 2 * MIN);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
