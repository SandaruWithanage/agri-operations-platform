import { RegisterWorker } from "./register-worker";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Agri Operations | Field" };
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <RegisterWorker />
        {children}
      </body>
    </html>
  );
}
