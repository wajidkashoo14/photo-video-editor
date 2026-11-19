"use client";

import { Clapperboard, Download, FolderOpen, Home, Image as ImageIcon, LayoutTemplate, Minimize2, Package, Palette, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui";
import { APP_NAME } from "@/config/app";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/projects", label: "My Projects", icon: FolderOpen },
  { href: "/photo", label: "Photo Editor", icon: ImageIcon },
  { href: "/video", label: "Video Editor", icon: Clapperboard },
  { href: "/compress", label: "Compress Video", icon: Minimize2 },
  { href: "/ai", label: "AI Tools", icon: Sparkles },
  { href: "/product", label: "Product Studio", icon: Package },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/brand", label: "Brand Kit", icon: Palette },
  { href: "/exports", label: "Export History", icon: Download },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function applyTheme(theme: string | null) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  // Editors get the full width: the sidebar collapses to an icon rail.
  const compact = path.startsWith("/photo") || path.startsWith("/video");
  useEffect(() => {
    try {
      applyTheme(localStorage.getItem("cs-theme"));
    } catch {
      /* storage unavailable: keep the default dark theme */
    }
  }, []);
  return (
    <div className="flex h-full w-full">
      <nav aria-label="Main" className={cn("flex shrink-0 flex-col border-r border-line bg-panel py-3 transition-[width]", compact ? "w-12 items-center px-1.5" : "w-52 px-2.5")}>
        <Link href="/" className={cn("mb-4 flex items-center gap-2 px-1.5", compact && "justify-center px-0")} aria-label={`${APP_NAME} home`}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-[13px] font-bold text-white">{APP_NAME[0]}</span>
          {!compact && <span className="truncate text-sm font-semibold tracking-tight">{APP_NAME}</span>}
        </Link>
        <ul className="flex flex-col gap-0.5">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  title={compact ? n.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-8 items-center gap-2.5 rounded-md text-[13px] transition-colors",
                    compact ? "w-9 justify-center" : "px-2",
                    active ? "bg-accent-soft text-accent" : "text-muted hover:bg-panel-2 hover:text-fg",
                  )}
                >
                  <n.icon size={16} />
                  {!compact && n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      <Toaster />
    </div>
  );
}

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
