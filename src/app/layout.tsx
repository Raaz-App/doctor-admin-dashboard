import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admin — Raaz MD",
  description: "Doctor admin: patients by status + login credential management.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="appbar">
          <span className="appbar__brand">Raaz MD</span>
          <span className="appbar__tag">Admin</span>
        </header>
        {children}
      </body>
    </html>
  );
}
