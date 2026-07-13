import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-black">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent-2 text-black">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-3.5 w-3.5"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 6h13l3 3-3 3H4z" />
                  <path d="M20 18H7l-3-3 3-3h13z" />
                </svg>
              </span>
              <span className="text-sm font-semibold text-white">DegenHub</span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
              Home for traders bots. Fast, focused Telegram tools for the
              Solana ecosystem — real-time on-chain intel where you already are.
            </p>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Product
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link href="/bots" className="text-zinc-300 hover:text-white">
                  All bots
                </Link>
              </li>
              <li>
                <Link
                  href="/bots/sol-wallet-watcher"
                  className="text-zinc-300 hover:text-white"
                >
                  Sol Wallet Watcher
                </Link>
              </li>
              <li>
                <Link href="/#how" className="text-zinc-300 hover:text-white">
                  How it works
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Links
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <a
                  href="https://t.me/SolWalletWatcherBot"
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-300 hover:text-white"
                >
                  Telegram
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-300 hover:text-white"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://solana.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-300 hover:text-white"
                >
                  Solana
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-border/60 pt-6 text-xs text-muted md:flex-row md:items-center">
          <p>
            © {new Date().getFullYear()} DegenHub. Home for traders bots.
          </p>
          <p className="flex items-center gap-2">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
            All bots operational
          </p>
        </div>
      </div>
    </footer>
  );
}
