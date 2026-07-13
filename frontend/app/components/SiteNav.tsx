import Link from "next/link";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-black/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-black">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-4 w-4"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6h13l3 3-3 3H4z" />
              <path d="M20 18H7l-3-3 3-3h13z" />
            </svg>
          </span>
          <span className="text-sm font-semibold tracking-tight text-white">
            DegenHub
          </span>
          <span className="hidden rounded-full border border-border bg-panel px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted sm:inline">
            Home for Traders Bots
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/">Home</NavLink>
          <NavLink href="/bots">Bots</NavLink>
          <NavLink href="/#how">How it works</NavLink>
          <NavLink href="/#stack">Stack</NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/bots"
            className="hidden rounded-full border border-border bg-panel px-4 py-2 text-xs font-medium text-white transition-colors hover:border-white/20 hover:bg-panel-2 sm:inline-flex"
          >
            View bots
          </Link>
          <a
            href="https://t.me/SolWalletWatcherBot"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-zinc-200"
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
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-panel hover:text-white"
    >
      {children}
    </Link>
  );
}
