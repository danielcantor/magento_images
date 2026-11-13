import "server-only";
import { NextResponse } from "next/server";
import { MagentoError } from "./magento";

/** Envuelve una ruta: convierte errores en JSON { error } con el status adecuado. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    try {
      const data = await fn(...args);
      return data instanceof Response ? data : NextResponse.json(data ?? { ok: true });
    } catch (err) {
      if (err instanceof MagentoError) {
        return NextResponse.json({ error: err.message }, { status: err.status || 500 });
      }
      if (err instanceof BadRequest) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      console.error(err);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  };
}

export class BadRequest extends Error {}

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequest("ID de imagen no válido");
  return id;
}
