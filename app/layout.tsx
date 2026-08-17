import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HeyKels",
  description:
    "An AI-native search engine that remembers context instead of search terms.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1b1c1d" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

// Applies the saved theme before first paint. Inline and synchronous on purpose:
// deferring it produces a visible flash of the wrong theme on every load.
const THEME_BOOT = `
(function(){try{
  var t = localStorage.getItem("heykels-theme");
  if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
