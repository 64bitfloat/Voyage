import type { Metadata, Viewport } from "next";
import PwaRegistrar from "@/components/PwaRegistrar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voyage — 旅のしおり＆Muse連携",
  description: "友人とリアルタイムで共同編集できるモバイルファーストな旅のしおり（PWA）",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Voyage",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="antialiased">
        <PwaRegistrar />
        {children}
      </body>
    </html>
  );
}
