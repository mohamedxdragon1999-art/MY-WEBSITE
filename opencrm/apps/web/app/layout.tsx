import "./globals.css";
import type { Metadata } from "next";

const metadata: Metadata = {
  title: "OpenCRM — AI CRM & Website Builder",
  description: "OpenCRM — AI website builder with 152 design systems. Create stunning funnels with AI in seconds.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
      <body className="bg-[#0a0b0f] text-white antialiased">{children}</body>
    </html>
  );
}