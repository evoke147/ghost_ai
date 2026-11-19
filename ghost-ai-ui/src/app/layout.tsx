import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GhostAI — Privacy-Focused Multi-Model AI & Cryptographic Verification",
  description: "Ephemeral, zero-storage multi-model AI comparison engine secured with client-side cryptographic sealing on the Midnight blockchain.",
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full">
      <body className="antialiased h-full bg-[#090a0f] text-[#f8fafc]">
        {children}
      </body>
    </html>
  );
}
