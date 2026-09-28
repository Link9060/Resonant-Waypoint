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
        <link rel="stylesheet" href="/orbit/arrow-shell.css?v=enterarrow-v3" />
        <script defer src="/orbit/arrow-shell.js?v=enterarrow-v3" />
      </head>
      <body>{children}</body>
    </html>
  );
}
