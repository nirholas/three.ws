import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pocket AR — a creature lives in your camera",
  description:
    "A tiny creature you can walk around your real world. Open the camera, grab the joystick, explore.",
  openGraph: {
    title: "Pocket AR",
    description: "A tiny creature lives in your camera. Walk it around.",
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
