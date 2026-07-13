import Link from "next/link";
import type { Bot } from "@/lib/bots";

const accentMap: Record<Bot["accent"], { glow: string; dot: string; ring: string }> = {
  green: {
    glow: "from-emerald-400/20 via-emerald-400/5 to-transparent",
    dot: "bg-emerald-400",
    ring: "group-hover:ring-emerald-400/40",
  },
  purple: {
    glow: "from-violet-500/20 via-violet-500/5 to-transparent",
    dot: "bg-violet-400",
    ring: "group-hover:ring-violet-400/40",
  },
  amber: {
    glow: "from-amber-400/20 via-amber-400/5 to-transparent",
    dot: "bg-amber-400",
    ring: "group-hover:ring-amber-400/40",
  },
  cyan: {
    glow: "from-cyan-400/20 via-cyan-400/5 to-transparent",
    dot: "bg-cyan-400",
    ring: "group-hover:ring-cyan-400/40",
  },
};

const statusLabel: Record<Bot["status"], string> = {
  live: "Live",
  beta: "Beta",
  "coming-soon": "Coming soon",
};

export function BotCard({ bot }: { bot: Bot }) {
  const accent = accentMap[bot.accent];

  return (
    <Link
      href={`/bots/${bot.slug}`}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-panel p-6 ring-1 ring-transparent transition-all hover:-translate-y-0.5 hover:border-white/15 hover:bg-panel-2 ${accent.ring}`}
    >
      <div
        className={`pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-gradient-to-br opacity-60 blur-3xl transition-opacity group-hover:opacity-100 ${accent.glow}`}
      />

      <div className="relative flex items-center justify-between">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-black/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-300">
          <span
            className={`h-1.5 w-1.5 rounded-full ${accent.dot} ${bot.status === "live" ? "pulse-dot" : ""}`}
          />
          {statusLabel[bot.status]}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted">
          {bot.chain}
        </span>
      </div>

      <div className="relative mt-6">
        <h3 className="text-lg font-semibold text-white">{bot.name}</h3>
        <p className="mt-1 text-xs font-medium uppercase tracking-widest text-muted">
          {bot.category}
        </p>
      </div>

      <p className="relative mt-4 text-sm leading-relaxed text-zinc-300">
        {bot.tagline}
      </p>

      <div className="relative mt-8 flex items-center justify-between">
        <span className="text-xs text-muted">View details</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-black/40 text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-white">
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </div>
    </Link>
  );
}
