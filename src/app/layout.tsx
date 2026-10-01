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
        <script src="/arrow-auth-guard.js?v=auth-v2" />
        <link rel="stylesheet" href="/arrow-shell.css?v=20261001" />
        <script defer src="/arrow-shell.js?v=20261001" />
      </head>
      <body>{children}</body>
    </html>
  );
}
