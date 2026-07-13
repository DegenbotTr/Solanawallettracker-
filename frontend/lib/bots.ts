export type BotStatus = "live" | "beta" | "coming-soon";

export type BotCommand = {
  command: string;
  description: string;
};

export type Bot = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  status: BotStatus;
  chain: string;
  telegramUrl: string;
  category: string;
  accent: "green" | "purple" | "amber" | "cyan";
  features: string[];
  commands: BotCommand[];
  stack: string[];
};

export const bots: Bot[] = [
  {
    slug: "sol-wallet-watcher",
    name: "Sol Wallet Watcher",
    tagline: "Real-time buy/sell alerts for any Solana wallet.",
    description:
      "A Telegram bot that subscribes to Solana wallets over WebSocket and pings you the moment a trade lands. Filter by USD size, label wallets, and pull a live portfolio snapshot without leaving your chat.",
    status: "live",
    chain: "Solana",
    telegramUrl: "https://t.me/SolWalletWatcherBot",
    category: "On-chain monitoring",
    accent: "green",
    features: [
      "Real-time buy/sell alerts via Helius WebSocket",
      "Portfolio snapshot with SPL tokens, SOL, and USD value",
      "Last 10 parsed transactions for any wallet",
      "Per-user minimum USD trade filter",
      "Human-readable wallet labels",
      "Chain guard rejects EVM / BTC / TRON addresses",
    ],
    commands: [
      { command: "/start", description: "Boot the bot and pin the menu keyboard" },
      { command: "/watch <address>", description: "Subscribe to a Solana wallet" },
      { command: "/unwatch <address>", description: "Stop watching a wallet" },
      { command: "/list", description: "Show every wallet you're tracking" },
      { command: "/portfolio <address>", description: "Full SPL + SOL + USD snapshot" },
      { command: "/tx <address>", description: "Parsed last 10 transactions" },
      { command: "/price <mint>", description: "Jupiter spot price for any token" },
      { command: "/label <address> <name>", description: "Rename a wallet" },
      { command: "/minsize <usd>", description: "Silence trades below this USD size" },
      { command: "/stats", description: "Uptime, users, active watchers" },
    ],
    stack: ["NestJS", "Telegraf", "@solana/web3.js", "Helius RPC + DAS", "Jupiter Price API", "CoinGecko"],
  },
];

export const getBot = (slug: string): Bot | undefined =>
  bots.find((bot) => bot.slug === slug);
