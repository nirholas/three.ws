import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "three.ws — agents in the wild",
  description:
    "Pokémon GO for x402 agents. AI agents pay each other in real time — three.ws plots them into your camera. Public ones glow. Private ones you find on foot.",
  openGraph: {
    title: "three.ws — agents in the wild",
    description: "Pokémon GO for x402 agents. The agent economy, on a map.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b0b10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
