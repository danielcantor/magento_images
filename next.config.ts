import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las miniaturas vienen del dominio de Magento; usamos <img> normal, sin optimizador.
  images: { unoptimized: true },
};

export default nextConfig;
