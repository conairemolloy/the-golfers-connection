import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Newsreader } from "next/font/google";
import { Masthead } from "@/components/masthead";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "The Golfers' Connection",
  description: "A private reciprocal access network for members of elite clubs in Ireland and Britain",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${newsreader.variable} ${archivo.variable} ${plexMono.variable} h-full`}>
      <body className="min-h-full bg-deep font-sans text-paper antialiased">
        {/* Lacquer column, capped at ~460px and centred on desktop so it
            reads as a phone-shaped members' handbook rather than a
            dashboard; full-bleed below that width for free, since
            max-width only clamps once the viewport exceeds it. */}
        <div className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col bg-lacquer">
          <Masthead />
          <div className="flex flex-1 flex-col">{children}</div>
        </div>
      </body>
    </html>
  );
}
