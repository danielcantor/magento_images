import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Imágenes Magento",
  description: "Carga y edición masiva de imágenes de productos en Magento 2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
