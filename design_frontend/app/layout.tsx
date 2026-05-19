import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Schema Cockpit",
  description: "AI schema design cockpit."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning on <body> guards against browser extensions
    // (Dark Reader, Grammarly, password managers) that mutate the DOM
    // before React hydrates and cause spurious mismatch warnings.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
