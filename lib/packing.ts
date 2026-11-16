// Reparte imágenes en envíos que no superen el límite de Vercel (4,5 MB por petición).
// Las imágenes de un mismo SKU van juntas y en orden; un archivo compartido por
// varios SKU cuenta una sola vez por envío.

export interface PackItem<F> {
  sku: string;
  file: F;
  size: number;
}

export function packItems<F, T extends PackItem<F>>(
  items: T[],
  opts: { maxBytes: number; maxItems: number },
): T[][] {
  // Agrupar por SKU respetando el orden de aparición.
  const groups: T[][] = [];
  const index = new Map<string, number>();
  for (const it of items) {
    let gi = index.get(it.sku);
    if (gi === undefined) {
      gi = groups.push([]) - 1;
      index.set(it.sku, gi);
    }
    groups[gi].push(it);
  }

  const packs: T[][] = [];
  let current: T[] = [];
  let files = new Set<F>();
  let bytes = 0;

  const flush = () => {
    if (current.length) packs.push(current);
    current = [];
    files = new Set();
    bytes = 0;
  };
  const extraBytes = (list: T[], seen: Set<F>) => {
    const local = new Set(seen);
    let add = 0;
    for (const it of list) {
      if (!local.has(it.file)) {
        local.add(it.file);
        add += it.size;
      }
    }
    return add;
  };
  const push = (it: T) => {
    if (!files.has(it.file)) {
      files.add(it.file);
      bytes += it.size;
    }
    current.push(it);
  };

  for (const group of groups) {
    const fits = (seen: Set<F>, used: number, count: number) =>
      count + group.length <= opts.maxItems && used + extraBytes(group, seen) <= opts.maxBytes;
    if (!fits(files, bytes, current.length)) flush();
    if (fits(files, bytes, current.length)) {
      group.forEach(push);
      continue;
    }
    // El SKU solo no cabe: se reparte en varios envíos, en orden.
    for (const it of group) {
      const add = files.has(it.file) ? 0 : it.size;
      if (current.length && (current.length + 1 > opts.maxItems || bytes + add > opts.maxBytes)) flush();
      push(it);
    }
  }
  flush();
  return packs;
}
