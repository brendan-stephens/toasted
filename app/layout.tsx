import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "TOASTED — jsonb vs Storage",
  description: "Benchmark querying car specs stored in Postgres jsonb vs Supabase Storage",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}
