import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "СМП — График",
  description: "Автоматическое составление графика фельдшеров СМП"
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
