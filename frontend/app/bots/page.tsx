import type { Metadata } from "next";
import { bots } from "@/lib/bots";
import { BotCard } from "../components/BotCard";

export const metadata: Metadata = {
  title: "Bots — DegenHub",
  description:
    "Every Telegram bot in the DegenHub portfolio. Real-time Solana monitoring, portfolio tools, and on-chain intel — all inside Telegram.",
};

export default function BotsPage() {
  const liveCount = bots.filter((b) => b.status === "live").length;

  return (
    <div className="bg-background">
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="grid-bg absolute inset-0 opacity-70" />
        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 sm:pt-28">
          <div className="max-w-3xl">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-accent">
              The Portfolio
            </div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl md:text-6xl">
              Every bot in the collection.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-zinc-400">
              Small, sharp Telegram bots for the Solana ecosystem. Each one is
              built to do one thing well — pick one, hit the launch link, and it
              works.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3 text-xs">
              <StatChip label="Live" value={String(liveCount)} tone="green" />
              <StatChip label="Chain" value="Solana" tone="purple" />
              <StatChip label="Custody" value="Zero" tone="neutral" />
              <StatChip label="Cost" value="Free" tone="neutral" />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {bots.map((bot) => (
            <BotCard key={bot.slug} bot={bot} />
          ))}

          <PlaceholderCard
            title="Sniper alerts"
            status="Planned"
            body="First-block detection for new SPL launches with liquidity thresholds."
          />
          <PlaceholderCard
            title="Copy-trade bot"
            status="Planned"
            body="Mirror trades from any wallet with your own thresholds and cooldowns."
          />
          <PlaceholderCard
            title="PnL dashboard"
            status="Planned"
            body="Rolling 24h / 7d / 30d PnL by wallet, delivered as a Telegram card."
          />
        </div>
      </section>

      <section className="border-t border-border/60 bg-panel/30">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="text-2xl font-semibold text-white sm:text-3xl">
            Got a bot idea?
          </h2>
          <p className="mt-3 text-sm text-zinc-400 sm:text-base">
            The portfolio grows every month. If you want a specific on-chain
            tool built into Telegram, ping me — new ideas ship fast.
          </p>
          <div className="mt-6">
            <a
              href="https://t.me/SolWalletWatcherBot"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-panel px-5 text-xs font-medium text-white hover:border-white/20 hover:bg-panel-2"
            >
              Send a request via Telegram
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "purple" | "neutral";
}) {
  const dot =
    tone === "green"
      ? "bg-emerald-400"
      : tone === "purple"
        ? "bg-violet-400"
        : "bg-zinc-400";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-panel px-3 py-1.5 text-zinc-300">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="text-muted">{label}</span>
      <span className="text-white">{value}</span>
    </span>
  );
}

function PlaceholderCard({
  title,
  status,
  body,
}: {
  title: string;
  status: string;
  body: string;
}) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-dashed border-border bg-panel/40 p-6">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <span className="relative inline-flex w-fit items-center gap-2 rounded-full border border-border bg-black/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        {status}
      </span>
      <h3 className="relative mt-6 text-lg font-semibold text-white">{title}</h3>
      <p className="relative mt-2 text-sm leading-relaxed text-zinc-400">
        {body}
      </p>
      <div className="relative mt-8 text-xs text-muted">Not shipped yet</div>
    </div>
  );
}
