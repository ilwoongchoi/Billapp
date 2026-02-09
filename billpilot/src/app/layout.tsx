import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "BillPilot — Stop Overpaying on Utility Bills",
  description: "Upload your electricity, gas, or water bill and get instant analysis. Detect overcharges, track costs, and receive monthly reports.",
  openGraph: {
    title: "BillPilot — Stop Overpaying on Utility Bills",
    description: "Upload your utility bill and get instant analysis. Detect overcharges, track costs over time.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BillPilot — Stop Overpaying on Utility Bills",
    description: "Upload your utility bill and get instant analysis. Detect overcharges, track costs over time.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
