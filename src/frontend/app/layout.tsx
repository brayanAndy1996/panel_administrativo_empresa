import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AccessProvider, AccessRouteGuard } from "../features/access/access-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Panel administrativo",
  description: "Panel local de administración de la empresa de software.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <AccessProvider>
          <AccessRouteGuard>{children}</AccessRouteGuard>
        </AccessProvider>
      </body>
    </html>
  );
}
