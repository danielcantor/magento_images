import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueMediaBulk, getBulkStatus } from "@/lib/magento";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  delete process.env.AUTH_MODE;
  process.env.MAGENTO_BASE_URL = "https://shop.test";
  process.env.MAGENTO_TOKEN = "tok";
  process.env.MAGENTO_STORE_CODE = "all";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const entry = (pos: number) => ({
  media_type: "image" as const,
  label: "",
  position: pos,
  disabled: false,
  types: [],
  content: { base64_encoded_data: "AAA", type: "image/jpeg", name: "x.jpg" },
});

describe("API bulk de Magento", () => {
  it("encola en /async/bulk con bySku y mapea aceptados/rechazados", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        bulk_uuid: "11111111-2222-3333-4444-555555555555",
        request_items: [
          { id: 0, data_hash: "h", status: "accepted" },
          { id: 1, data_hash: "h", status: "rejected", error_message: "Bad sku" },
        ],
        errors: true,
      }),
    );
    const r = await enqueueMediaBulk([{ sku: "A", entry: entry(1) }, { sku: "B/1", entry: entry(2) }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://shop.test/rest/all/async/bulk/V1/products/bySku/media");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual([{ sku: "A", entry: entry(1) }, { sku: "B/1", entry: entry(2) }]);
    expect(r).toEqual({
      bulkUuid: "11111111-2222-3333-4444-555555555555",
      items: [{ accepted: true }, { accepted: false, message: "Bad sku" }],
    });
  });

  it("estado: ordena por id, mapea estados y nunca devuelve serialized_data", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        operations_list: [
          { id: 12, status: 3, result_message: "Producto no existe", serialized_data: "{\"base64\":\"…\"}" },
          { id: 10, status: 1, result_message: "Service execution success", serialized_data: "x" },
          { id: 11, status: 4, result_message: null, serialized_data: "x" },
          { id: 13, status: 5, result_message: "rejected", serialized_data: "x" },
        ],
      }),
    );
    const r = await getBulkStatus("abc");
    expect(fetchMock.mock.calls[0][0]).toBe("https://shop.test/rest/all/V1/bulk/abc/detailed-status");
    expect(r.operations.map((o) => o.state)).toEqual(["complete", "open", "failed", "failed"]);
    expect(r.operations[2].message).toBe("Producto no existe");
    expect(JSON.stringify(r)).not.toContain("serialized");
  });
});
