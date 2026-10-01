import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Waypoint — ARROW",
  description: "Turn everything going on into a clear next move."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {!process.env.NEXT_PUBLIC_ARROW_SHELL_BASE?.startsWith("/Resonant-Relay/arrow") && <script src="/arrow-auth-guard.js?v=auth-v2" />}
        <link rel="stylesheet" href={`${process.env.NEXT_PUBLIC_ARROW_SHELL_BASE || ''}/arrow-shell.css?v=beta-repair-1`} />
        <script defer src={`${process.env.NEXT_PUBLIC_ARROW_SHELL_BASE || ''}/arrow-shell.js?v=beta-repair-1`} />
      </head>
      <body>{children}</body>
    </html>
  );
}
