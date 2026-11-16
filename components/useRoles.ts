"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { FALLBACK_ROLES, type MediaRole } from "@/lib/types";

let memo: Promise<{ roles: MediaRole[]; firstImageRoles: string[] }> | null = null;

/** Roles de imagen de la tienda (se piden una vez por pestaña). */
export function useRoles() {
  const [state, setState] = useState<{ roles: MediaRole[]; firstImageRoles: string[]; loaded: boolean }>({
    roles: FALLBACK_ROLES,
    firstImageRoles: FALLBACK_ROLES.map((r) => r.code),
    loaded: false,
  });
  useEffect(() => {
    memo ??= api.roles().catch(() => {
      memo = null;
      return { roles: FALLBACK_ROLES, firstImageRoles: FALLBACK_ROLES.map((r) => r.code) };
    });
    let alive = true;
    memo.then((r) => alive && setState({ ...r, loaded: true }));
    return () => {
      alive = false;
    };
  }, []);
  const labelOf = (code: string) => state.roles.find((r) => r.code === code)?.label ?? code;
  return { ...state, labelOf };
}
