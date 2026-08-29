import Link from "next/link";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { MobileNav } from "@/components/mobile-nav";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/chat", label: "Chat" },
  { href: "/waivers", label: "Waivers" },
  { href: "/moves", label: "Moves" },
  { href: "/trades", label: "Trades" },
  { href: "/news", label: "News" },
  { href: "/roster", label: "Roster" },
  { href: "/schedule", label: "Schedule" },
  { href: "/history", label: "History" },
];

export function NavBar() {
  return (
    <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
      <div className="w-full max-w-6xl flex justify-between items-center gap-3 p-3 px-5 text-sm">
        <div className="flex gap-4 items-center font-semibold min-w-0">
          {/* Always the short form — the full name plus 8 nav links plus the auth
           *  greeting was the whole reason this stopped fitting; freeing this ~100px
           *  permanently is simpler and safer than another breakpoint to juggle. */}
          <Link href="/" className="shrink-0">
            FF Copilot
          </Link>
          {/* Below `lg` there isn't room for all the links plus the brand + auth
           *  controls — MobileNav's hamburger takes over there instead of cramming
           *  (found live: 8 links no longer fit even at typical desktop widths once
           *  "Moves" was added, since this only used to switch at `sm`). */}
          <div className="hidden lg:flex gap-3 font-normal text-foreground/70">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hover:text-foreground whitespace-nowrap transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Suspense>
            <AuthButton />
          </Suspense>
          <ThemeSwitcher />
          <MobileNav links={LINKS} />
        </div>
      </div>
    </nav>
  );
}
