"use client";
// Prepara la imagen en el navegador: redimensiona, comprime y convierte a un
// formato que Magento acepta, para no superar el límite de 4,5 MB de Vercel.
import imageCompression from "browser-image-compression";

const MAX_MB = 3;
const MAX_SIDE = 2500;

export async function prepareImage(file: File): Promise<File> {
  const type = file.type.toLowerCase();
  // GIF: se envía tal cual (comprimir rompería la animación).
  if (type === "image/gif") return file;

  const targetType = type === "image/png" ? "image/png" : "image/jpeg";
  const needsConvert = targetType !== type && !(type === "image/jpg");
  if (!needsConvert && file.size <= MAX_MB * 1024 * 1024) {
    const dims = await imageSize(file).catch(() => null);
    if (dims && Math.max(dims.w, dims.h) <= MAX_SIDE) return file;
  }

  const out = await imageCompression(file, {
    maxSizeMB: MAX_MB,
    maxWidthOrHeight: MAX_SIDE,
    fileType: targetType,
    initialQuality: 0.9,
    useWebWorker: true,
  });
  const ext = targetType === "image/png" ? "png" : "jpg";
  return new File([out], file.name.replace(/\.[^.]+$/, "") + "." + ext, { type: targetType });
}

function imageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
