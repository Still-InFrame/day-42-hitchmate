import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION =
  "Drop a pin, get seen by nearby drivers, and connect safely until pickup.";

export const metadata: Metadata = {
  metadataBase: new URL("https://hitchmate.100dayaichallenge.com"),
  title: "HitchMate — get picked up",
  description: DESCRIPTION,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "HitchMate",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "HitchMate — get picked up",
    description: DESCRIPTION,
    images: ["/hero.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "HitchMate — get picked up",
    description: DESCRIPTION,
    images: ["/hero.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1120",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
