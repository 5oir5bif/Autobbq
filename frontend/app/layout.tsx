import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AutoBBQ",
  description: "Upload, translate and render Chinese subtitle videos.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
