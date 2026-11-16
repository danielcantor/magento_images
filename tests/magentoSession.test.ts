import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openMagentoSession, sealMagentoSession } from "@/lib/session";

beforeEach(() => {
  process.env.SESSION_SECRET = "una-clave-de-prueba-larga";
});

const future = () => Math.floor(Date.now() / 1000) + 3600;

describe("sesión de Magento cifrada", () => {
  it("ida y vuelta", async () => {
    const sealed = await sealMagentoSession({ token: "tok-123", username: "ana", exp: future() });
    expect(sealed).not.toContain("tok-123");
    expect(await openMagentoSession(sealed)).toMatchObject({ token: "tok-123", username: "ana" });
  });

  it("rechaza cookies manipuladas", async () => {
    const sealed = await sealMagentoSession({ token: "t", username: "ana", exp: future() });
    const [iv, data] = sealed.split(".");
    const flipped = data.slice(0, -2) + (data.at(-2) === "A" ? "B" : "A") + data.at(-1);
    expect(await openMagentoSession(`${iv}.${flipped}`)).toBeNull();
    expect(await openMagentoSession("basura")).toBeNull();
    expect(await openMagentoSession(undefined)).toBeNull();
  });

  it("rechaza sesiones caducadas", async () => {
    const sealed = await sealMagentoSession({ token: "t", username: "ana", exp: Math.floor(Date.now() / 1000) - 1 });
    expect(await openMagentoSession(sealed)).toBeNull();
  });

  it("rechaza si cambia la clave", async () => {
    const sealed = await sealMagentoSession({ token: "t", username: "ana", exp: future() });
    process.env.SESSION_SECRET = "otra-clave-completamente-distinta";
    expect(await openMagentoSession(sealed)).toBeNull();
  });

  it("exige SESSION_SECRET largo", async () => {
    process.env.SESSION_SECRET = "corta";
    await expect(sealMagentoSession({ token: "t", username: "a", exp: future() })).rejects.toThrow(/SESSION_SECRET/);
  });
});

// --- Cliente de Magento en modo usuario ---
const cookieValue = { current: undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("magento en modo usuario", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "magento";
    process.env.MAGENTO_BASE_URL = "https://shop.test";
    process.env.MAGENTO_TOKEN = "token-integracion";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    delete process.env.AUTH_MODE;
    vi.unstubAllGlobals();
  });

  it("getAdminToken usa el endpoint 2FA con código y el normal sin código", async () => {
    const { getAdminToken } = await import("@/lib/magento");
    fetchMock.mockResolvedValueOnce(json("adm-1")).mockResolvedValueOnce(json("adm-2"));
    expect(await getAdminToken("ana", "pw", "123456")).toBe("adm-1");
    expect(await getAdminToken("ana", "pw")).toBe("adm-2");
    const [u1, i1] = fetchMock.mock.calls[0];
    const [u2, i2] = fetchMock.mock.calls[1];
    expect(u1).toBe("https://shop.test/rest/all/V1/tfa/provider/google/authenticate");
    expect(JSON.parse(i1.body)).toEqual({ username: "ana", password: "pw", otp: "123456" });
    expect(i1.headers.Authorization).toBeUndefined();
    expect(u2).toBe("https://shop.test/rest/all/V1/integration/admin/token");
    expect(i2.headers.Authorization).toBeUndefined();
  });

  it("traduce credenciales incorrectas", async () => {
    const { getAdminToken } = await import("@/lib/magento");
    fetchMock.mockResolvedValueOnce(
      json({ message: "The account sign-in was incorrect or your account is disabled temporarily. Please wait and try again later." }, 401),
    );
    await expect(getAdminToken("ana", "mal", "123456")).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/incorrectos/) });
  });

  it("usa el token del usuario, no el de integración, y mapea 401 a 403", async () => {
    const { getMedia } = await import("@/lib/magento");
    cookieValue.current = await sealMagentoSession({ token: "token-ana", username: "ana", exp: future() });
    fetchMock.mockResolvedValueOnce(json([]));
    await getMedia("SKU");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer token-ana");

    fetchMock.mockResolvedValueOnce(json({ message: "The consumer isn't authorized to access %resources." }, 401));
    await expect(getMedia("SKU")).rejects.toMatchObject({ status: 403 });
  });

  it("sin sesión responde 401 sin llamar a Magento", async () => {
    const { getMedia } = await import("@/lib/magento");
    cookieValue.current = undefined;
    await expect(getMedia("SKU")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
