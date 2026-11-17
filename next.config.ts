import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tailwind CSS は postcss.config.mjs（@tailwindcss/postcss）で処理する
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
};

export default nextConfig;
