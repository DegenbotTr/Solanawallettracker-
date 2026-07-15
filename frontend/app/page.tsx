import Link from "next/link";
import Image from "next/image";
import { bots } from "@/lib/bots";
import { BotCard } from "./components/BotCard";
import { HeroDemo } from "./components/HeroDemo";
import { ScrambleText } from "./components/ScrambleText";

const COMMUNITY_URL = "https://t.me/Degenhubtrade";

export default function Home() {
  const featured = bots.slice(0, 3);

  return (
    <div className="bg-background">
      {/* HERO */}
      <section className="relative overflow-hidden">
        {/* Full-bleed hero art as the section background */}
        <div className="absolute inset-0">
          <Image
            src="/heroimage.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-[70%_center]"
          />
          {/* Scrims — keep the art visible but the text readable, and blend
              the section into the black page at top & bottom */}
          <div className="absolute inset-0 bg-black/55" />
          <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-background" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pt-28 pb-24 sm:pt-36 sm:pb-32">
          <div className="relative z-10 mx-auto max-w-3xl text-center">
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.8)] sm:text-6xl md:text-7xl">
              <ScrambleText phrases={["Trading bots that"]} />
              <br />
              <ScrambleText
                className="text-brand-gradient"
                phrases={[
                  "move at degen speed.",
                  "scan every chain.",
                  "never miss a call.",
                ]}
              />
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-zinc-300 drop-shadow-[0_1px_8px_rgba(0,0,0,0.9)] sm:text-lg">
              The hub for fast, focused Telegram trading bots — across{" "}
              <span className="text-white">Solana and EVM</span> chains
              (Ethereum, BSC, Base, Arbitrum). Real-time wallet tracking,
              multi-chain token scanning, and a community of traders.
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/bots"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-black shadow-lg transition-colors hover:bg-zinc-200"
              >
                Explore the bots
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <a
                href={COMMUNITY_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-accent-2/50 bg-black/50 px-6 text-sm font-medium text-white backdrop-blur transition-colors hover:border-accent-2 hover:bg-accent-2/20"
              >
                <TelegramIcon className="h-4 w-4 text-accent-2" />
                Join the community
              </a>
            </div>

            <p className="mt-6 text-xs text-zinc-400 drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]">
              No signup. No custody. Nothing to install. Open a Telegram chat,
              hit start.
            </p>
          </div>

          {/* Rotating demo — cycles through DM wallet alerts and group alpha */}
          <div className="relative z-10 mx-auto mt-16 max-w-2xl">
            <HeroDemo />
          </div>
        </div>
      </section>

      {/* METRICS STRIP */}
      <section className="border-y border-border/60 bg-panel/30">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4">
          <Metric label="Latency" value="<1s" hint="Alert delivery" />
          <Metric label="Chains" value="5+" hint="Solana + EVM" />
          <Metric label="Custody" value="Zero" hint="Read-only" />
          <Metric label="Bots shipped" value="1" hint="More cooking" />
        </div>
      </section>

      {/* FEATURED BOTS */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <SectionHeader
          eyebrow="The Portfolio"
          title="Every bot in one place."
          description="Small, focused tools. Each one solves a real problem for on-chain users — nothing bloated, nothing generic."
        />

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {featured.map((bot) => (
            <BotCard key={bot.slug} bot={bot} />
          ))}
          <ComingSoonCard
            title="More bots dropping"
            description="Sniper alerts, wallet copy-trade, PnL dashboards. The next one lands soon."
          />
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/bots"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-panel px-4 text-xs font-medium text-white hover:border-white/20 hover:bg-panel-2"
          >
            View all bots
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="border-t border-border/60 bg-panel/20">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <SectionHeader
            eyebrow="How it works"
            title="From wallet to alert in three steps."
            description="Every bot follows the same simple flow. No wallet connection required — bots read on-chain data through Helius and push results straight to Telegram."
          />

          <div className="mt-14 grid gap-4 md:grid-cols-3">
            <Step
              number="01"
              title="Open Telegram"
              body="Search for the bot handle and hit start. No signup, no email, no seed phrase."
            />
            <Step
              number="02"
              title="Configure"
              body="Paste a Solana address, set filters, pick thresholds. State lives in memory — private to your chat."
            />
            <Step
              number="03"
              title="Get alerted"
              body="Confirmed trades ping you within a second. Portfolio and TX history are a single command away."
            />
          </div>
        </div>
      </section>

      {/* STACK */}
      <section id="stack" className="mx-auto max-w-6xl px-6 py-24">
        <SectionHeader
          eyebrow="Under the hood"
          title="Built on fast, reliable on-chain infrastructure."
          description="Every bot is a NestJS service — Solana wallet alerts via Helius WebSockets, multi-chain token data via DexScreener, and EVM security via GoPlus. TypeScript end-to-end."
        />

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <StackCard
            title="Helius"
            body="Solana mainnet RPC and WebSocket subscriptions. DAS API for full portfolio snapshots including SPL tokens."
          />
          <StackCard
            title="DexScreener"
            body="Cross-chain price, market cap, and liquidity for Solana and every EVM chain — the backbone of the token info cards."
          />
          <StackCard
            title="GoPlus Security"
            body="EVM token safety checks — honeypot detection, buy/sell tax, mintability, and ownership risk, keyless and free."
          />
          <StackCard
            title="RugCheck + GeckoTerminal"
            body="Solana rug analysis and cross-chain token logos, so every card ships with security context and a real image."
          />
          <StackCard
            title="NestJS + Telegraf"
            body="Every command is a decorated handler. Multi-step flows use a small state machine, with state persisted in Postgres via Prisma."
          />
          <StackCard
            title="Zero custody"
            body="Every bot is read-only. No private keys touch the server — ever."
          />
        </div>
      </section>

      {/* COMMUNITY */}
      <section
        id="community"
        className="relative overflow-hidden border-t border-border/60 bg-panel/20"
      >
        <div className="pointer-events-none absolute inset-0 opacity-70">
          <div className="absolute -top-32 left-1/2 h-72 w-[560px] -translate-x-1/2 rounded-full bg-accent-2/20 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-4xl px-6 py-24">
          <div className="overflow-hidden rounded-3xl border border-accent-2/25 bg-gradient-to-b from-accent-2/10 to-transparent p-8 text-center sm:p-12">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent-2/30 bg-black/40 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-accent-2">
              <TelegramIcon className="h-3.5 w-3.5" />
              The community
            </span>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Trade alongside other degens.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-zinc-300">
              DegenHub isn&apos;t just bots — it&apos;s a community. Share calls,
              swap alpha, and get early access to every new bot we ship. Drop a
              CA in the group and let the bot track who called it first.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={COMMUNITY_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-black hover:bg-zinc-200"
              >
                <TelegramIcon className="h-4 w-4" />
                Join @Degenhubtrade
              </a>
              <a
                href="https://t.me/De1trackBot"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-panel px-6 text-sm font-medium text-white hover:border-white/20 hover:bg-panel-2"
              >
                Try DegenTrack
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden border-t border-border/60">
        <div className="pointer-events-none absolute inset-0 opacity-60">
          <div className="absolute -top-40 left-1/2 h-80 w-[600px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
          <div className="absolute top-20 left-1/3 h-60 w-96 rounded-full bg-accent-2/20 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-3xl px-6 py-24 text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Ready to track the chain?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-zinc-400">
            Open DegenTrack in Telegram, paste a wallet or any token contract,
            and start catching every move the moment it lands on-chain.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="https://t.me/De1trackBot"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-black hover:bg-zinc-200"
            >
              <TelegramIcon className="h-4 w-4" />
              Launch DegenTrack
            </a>
            <Link
              href="/bots"
              className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-panel px-6 text-sm font-medium text-white hover:border-white/20 hover:bg-panel-2"
            >
              Browse all bots
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-accent">
        {eyebrow}
      </div>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-zinc-400 sm:text-base">
        {description}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="bg-background px-6 py-8 text-center sm:text-left">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-white">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted">{hint}</div>
    </div>
  );
}

function Step({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-panel p-6">
      <div className="text-5xl font-semibold text-brand-gradient">{number}</div>
      <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}

function StackCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-panel p-6 transition-colors hover:border-white/15 hover:bg-panel-2">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}

function ComingSoonCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-dashed border-border bg-panel/40 p-6">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <span className="relative inline-flex w-fit items-center gap-2 rounded-full border border-border bg-black/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        In the oven
      </span>
      <h3 className="relative mt-6 text-lg font-semibold text-white">
        {title}
      </h3>
      <p className="relative mt-2 text-sm leading-relaxed text-zinc-400">
        {description}
      </p>
    </div>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M21.05 3.05 2.98 9.98c-1.23.48-1.22 1.16-.22 1.46l4.63 1.44 10.72-6.76c.51-.31.97-.14.59.2l-8.69 7.85-.34 5.05c.5 0 .72-.22 1-.5l2.4-2.34 4.98 3.68c.92.51 1.58.24 1.81-.85l3.28-15.46c.34-1.38-.53-2-1.42-1.7Z" />
    </svg>
  );
}
