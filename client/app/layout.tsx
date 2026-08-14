import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InboxIt — AI-Sorted Gmail Client",
  description:
    "Your inbox, finally under control. AI-sorted Gmail client for Indian students and professionals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
