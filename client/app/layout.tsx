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
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
