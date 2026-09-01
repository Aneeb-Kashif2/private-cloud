import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";
export const metadata: Metadata = { title: "Self Cloud", description: "Private cloud storage you control" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}<Toaster richColors position="bottom-right" /></body></html>;
}
