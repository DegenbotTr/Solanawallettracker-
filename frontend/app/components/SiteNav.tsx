import Link from "next/link";
import { BrandMark } from "./BrandMark";
import { MobileMenu } from "./MobileMenu";

const COMMUNITY_URL = "https://t.me/Degenhubtrade";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-black/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark size={34} />
          <span className="text-sm font-semibold tracking-tight text-white">
            DegenHub
          </span>
          <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-accent-2/40 bg-panel px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider lg:inline-flex">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="badge-shimmer">Home for Traders Bots</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/">Home</NavLink>
          <NavLink href="/bots">Bots</NavLink>
          <NavLink href="/#how">How it works</NavLink>
          <NavLink href="/#community">Community</NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={COMMUNITY_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-panel px-4 py-2 text-xs font-medium text-white transition-colors hover:border-accent-2/40 hover:bg-panel-2 lg:inline-flex"
          >
            <TelegramIcon className="h-3.5 w-3.5 text-accent-2" />
            Community
          </a>
          <a
            href="https://t.me/De1trackBot"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-zinc-200 sm:inline-flex"
          >
            Launch bot
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M21.05 3.05 2.98 9.98c-1.23.48-1.22 1.16-.22 1.46l4.63 1.44 10.72-6.76c.51-.31.97-.14.59.2l-8.69 7.85-.34 5.05c.5 0 .72-.22 1-.5l2.4-2.34 4.98 3.68c.92.51 1.58.24 1.81-.85l3.28-15.46c.34-1.38-.53-2-1.42-1.7Z" />
    </svg>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-panel hover:text-white"
    >
      {children}
    </Link>
  );
}
