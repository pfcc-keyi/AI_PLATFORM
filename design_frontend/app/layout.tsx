import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Schema Design Cockpit",
  description:
    "AI-assisted schema design cockpit: upload an Excel data dictionary, explore a 3D ERD, refine with natural language."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
