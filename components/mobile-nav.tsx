"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Calendar,
  Clock,
  Handshake,
  LayoutDashboard,
  Menu,
  MessageCircle,
  Newspaper,
  Search,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICON: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/chat": MessageCircle,
  "/waivers": Search,
  "/moves": ArrowLeftRight,
  "/trades": Handshake,
  "/news": Newspaper,
  "/roster": Users,
  "/schedule": Calendar,
  "/history": Clock,
};

/**
 * `lg:hidden` companion to NavBar's desktop link row, which only shows above `lg` (see
 * NavBar — bumped up from `sm` once 8 links stopped fitting even at typical desktop
 * widths). Below `lg`, this hamburger is the only way to reach any page but Dashboard.
 */
export function MobileNav({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        className="p-1.5 -mr-1.5 text-foreground/70 hover:text-foreground"
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      {open && (
        <div className="fixed inset-x-0 top-16 z-50 border-b bg-background animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex flex-col p-2">
            {links.map((link) => {
              const Icon = ICON[link.href] ?? LayoutDashboard;
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors",
                    active
                      ? "bg-muted font-medium"
                      : "text-foreground/70 hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon size={16} />
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
