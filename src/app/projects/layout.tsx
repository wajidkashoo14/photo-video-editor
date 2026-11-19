import type { Metadata } from "next";

export const metadata: Metadata = { title: "My Projects" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
