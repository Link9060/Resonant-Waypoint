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
        <link rel="stylesheet" href="https://link9060.github.io/Resonant-Orbit/arrow-shell.css?v=20260927-arrow-shell-layout-v1" />
        <script defer src="https://link9060.github.io/Resonant-Orbit/arrow-shell.js?v=20260927-arrow-shell-layout-v1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
