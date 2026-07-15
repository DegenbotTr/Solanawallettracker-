import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
} from '@solana/web3.js';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';

const startTime = new Date();

@Injectable()
export class SolanaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SolanaService.name);
  private connection: Connection;
  private apiKey: string;
  private watchedWallets = new Map<
    string,
    { subId: number; chatIds: Set<number> }
  >();

  // Cached SOL price to avoid slamming CoinGecko under alert bursts.
  private solPriceCache: {
    price: number;
    change24h: number;
    fetchedAt: number;
  } | null = null;
  private static readonly SOL_PRICE_TTL_MS = 30_000;

  // Peak-MC poller — updates TokenPeak for recently-called mints every 5 min.
  private peakPollTimer: NodeJS.Timeout | null = null;
  private static readonly PEAK_POLL_INTERVAL_MS = 5 * 60 * 1000;
  private static readonly PEAK_LOOKBACK_DAYS = 7;

  // Insider-cluster dedup: `${chatId}:${mint}` → last-alert timestamp.
  // Prevents spamming a user when the same insider cluster keeps firing.
  private insiderClusterAlerted = new Map<string, number>();
  private static readonly INSIDER_DEDUP_MS = 5 * 60 * 1000;
  private static readonly INSIDER_WINDOW_SEC = 60;
  private static readonly INSIDER_MIN_WALLETS = 3;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    @InjectBot() private bot: Telegraf,
  ) {}

  async onModuleInit() {
    this.apiKey = this.config.get<string>('HELIUS_API_KEY');
    const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
    const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;

    this.connection = new Connection(rpcUrl, {
      wsEndpoint: wsUrl,
      commitment: 'confirmed',
    });

    // Restore ALL watched wallets from the database on startup
    const allWatched = await this.prisma.wallet.findMany({
      include: { watchers: true },
    });

    for (const w of allWatched) {
      if (w.watchers.length > 0) {
        // null chatId because we just want to start the WebSocket, chatIds are in DB
        await this.initWalletSubscription(w.address);
      }
    }

    const envWallets = this.config.get<string>('WATCHED_WALLETS', '');
    if (envWallets) {
      for (const addr of envWallets.split(',')) {
        const trimmed = addr.trim();
        if (trimmed) await this.watchWallet(trimmed, null);
      }
    }

    // Kick off peak-MC poller (fire-and-forget). First run is delayed a minute
    // so the app finishes booting before we start hitting external APIs.
    this.peakPollTimer = setInterval(() => {
      this.pollTokenPeaks().catch((err) =>
        this.logger.error(`Peak poll failed: ${err.message}`),
      );
    }, SolanaService.PEAK_POLL_INTERVAL_MS);
    setTimeout(
      () =>
        this.pollTokenPeaks().catch((err) =>
          this.logger.error(`Initial peak poll failed: ${err.message}`),
        ),
      60_000,
    );
  }

  onModuleDestroy() {
    this.watchedWallets.forEach(({ subId }) => {
      this.connection.removeOnLogsListener(subId).catch(() => {});
    });
    if (this.peakPollTimer) {
      clearInterval(this.peakPollTimer);
      this.peakPollTimer = null;
    }
  }

  /**
   * Update TokenPeak for every mint that's been called in a group in the last
   * PEAK_LOOKBACK_DAYS. Uses DexScreener FDV as market cap proxy. Bumps
   * peakMcUsd only when current > peak. Runs every PEAK_POLL_INTERVAL_MS.
   */
  private async pollTokenPeaks(): Promise<void> {
    const since = new Date(
      Date.now() - SolanaService.PEAK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const called = await this.prisma.groupTokenCall.findMany({
      where: { calledAt: { gte: since } },
      select: { mint: true },
      distinct: ['mint'],
    });
    const mints = called.map((c) => c.mint);
    if (mints.length === 0) return;

    const currentMcs = await this.getCurrentMarketCaps(mints);
    const now = new Date();
    let updated = 0;

    for (const [mint, currentMc] of currentMcs) {
      if (currentMc <= 0) continue;
      const existing = await this.prisma.tokenPeak.findUnique({
        where: { mint },
      });
      if (!existing) {
        await this.prisma.tokenPeak.create({
          data: {
            mint,
            peakMcUsd: currentMc,
            peakAt: now,
            lastCheckedAt: now,
            lastMcUsd: currentMc,
          },
        });
        updated++;
      } else if (currentMc > existing.peakMcUsd) {
        await this.prisma.tokenPeak.update({
          where: { mint },
          data: {
            peakMcUsd: currentMc,
            peakAt: now,
            lastCheckedAt: now,
            lastMcUsd: currentMc,
          },
        });
        updated++;
      } else {
        await this.prisma.tokenPeak.update({
          where: { mint },
          data: { lastCheckedAt: now, lastMcUsd: currentMc },
        });
      }
    }
    this.logger.log(
      `Peak poll: ${mints.length} mints checked, ${updated} peaks updated`,
    );
  }
  private async initWalletSubscription(address: string): Promise<number> {
    if (this.watchedWallets.has(address)) {
      return this.watchedWallets.get(address).subId;
    }

    const subId = this.connection.onLogs(
      new PublicKey(address),
      async (logs) => {
        if (logs.err) return;
        await this.handleTransaction(address, logs.signature);
      },
      'confirmed',
    );

    this.watchedWallets.set(address, { subId, chatIds: new Set() });
    this.logger.log(`Subscription active for: ${address}`);
    return subId;
  }

  // ─── Wallet Watch ────────────────────────────────────────────────────────────

  async validateWallet(
    address: string,
  ): Promise<'valid' | 'invalid_address' | 'not_wallet'> {
    try {
      new PublicKey(address);
    } catch {
      return 'invalid_address';
    }

    try {
      const accountInfo = await this.connection.getAccountInfo(
        new PublicKey(address),
      );

      // Account doesn't exist yet — could be a new/empty wallet, allow it
      if (!accountInfo) return 'valid';

      // System Program owner = regular wallet
      const SYSTEM_PROGRAM = '11111111111111111111111111111111';
      if (accountInfo.owner.toBase58() === SYSTEM_PROGRAM) return 'valid';

      // Anything else is a program, token mint, or contract — reject it
      return 'not_wallet';
    } catch {
      // RPC error — allow it rather than blocking the user
      return 'valid';
    }
  }

  async watchWallet(address: string, chatId: number | null): Promise<boolean> {
    try {
      new PublicKey(address);
    } catch {
      return false;
    }

    // 1. Ensure wallet exists in DB
    await this.prisma.wallet.upsert({
      where: { address },
      create: { address },
      update: {},
    });

    // 2. Add user-wallet link (WatchedWallet)
    if (chatId) {
      // Ensure user exists (best effort)
      await this.prisma.user.upsert({
        where: { id: chatId },
        create: { id: chatId },
        update: {},
      });

      await this.prisma.watchedWallet.upsert({
        where: {
          userId_walletAddress: { userId: chatId, walletAddress: address },
        },
        create: { userId: chatId, walletAddress: address },
        update: {},
      });
    }

    // 3. Ensure WebSocket listener is active
    await this.initWalletSubscription(address);
    return true;
  }

  async unwatchWallet(address: string, chatId: number): Promise<boolean> {
    try {
      // Remove the join record
      await this.prisma.watchedWallet.delete({
        where: {
          userId_walletAddress: { userId: chatId, walletAddress: address },
        },
      });

      // Check if anyone else is still watching this wallet
      const otherWatchers = await this.prisma.watchedWallet.count({
        where: { walletAddress: address },
      });

      if (otherWatchers === 0) {
        const entry = this.watchedWallets.get(address);
        if (entry) {
          this.connection.removeOnLogsListener(entry.subId).catch(() => {});
          this.watchedWallets.delete(address);
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async getWatchedWallets(
    chatId: number,
  ): Promise<{ address: string; label: string; paused: boolean }[]> {
    const list = await this.prisma.watchedWallet.findMany({
      where: { userId: chatId },
      select: { walletAddress: true, label: true, paused: true },
    });
    return list.map((item) => ({
      address: item.walletAddress,
      label: item.label ?? '',
      paused: item.paused,
    }));
  }

  async setWalletLabel(
    chatId: number,
    address: string,
    label: string,
  ): Promise<boolean> {
    try {
      await this.prisma.watchedWallet.update({
        where: {
          userId_walletAddress: { userId: chatId, walletAddress: address },
        },
        data: { label },
      });
      return true;
    } catch {
      return false;
    }
  }

  async getWalletLabel(chatId: number, address: string): Promise<string> {
    const entry = await this.prisma.watchedWallet.findUnique({
      where: {
        userId_walletAddress: { userId: chatId, walletAddress: address },
      },
      select: { label: true },
    });
    return entry?.label ?? '';
  }
  // ─── Wallet Tags ─────────────────────────────────────────────────────────────
  // Note: Tags functionality requires Prisma array operations support
  // These methods are available but may need schema adjustments

  async addWalletTag(
    chatId: number,
    address: string,
    tag: string,
  ): Promise<boolean> {
    try {
      const entry = await this.prisma.watchedWallet.findUnique({
        where: {
          userId_walletAddress: { userId: chatId, walletAddress: address },
        },
        select: { tags: true },
      });
      if (!entry) return false;

      const normalizedTag = tag.toLowerCase().trim();
      if (entry.tags.includes(normalizedTag)) return true; // already has tag

      const newTags = [...entry.tags, normalizedTag];
      await this.prisma.watchedWallet.update({
        where: {
          userId_walletAddress: { userId: chatId, walletAddress: address },
        },
        data: { tags: newTags },
      });
      return true;
    } catch {
      return false;
    }
  }

  async removeWalletTag(
    chatId: number,
    address: string,
    tag: string,
  ): Promise<boolean> {
    try {
      const entry = await this.prisma.watchedWallet.findUnique({
        where: {
          userId_walletAddress: { userId: chatId, walletAddress: address },
        },
        select: { tags: true },
      });
      if (!entry) return false;

      const normalizedTag = tag.toLowerCase().trim();
      const newTags = entry.tags.filter((t) => t !== normalizedTag);

      await this.prisma.watchedWallet.update({
        where: {
          userId_walletAddress: { userId: chatId, walletAddress: address },
        },
        data: { tags: newTags },
      });
      return true;
    } catch {
      return false;
    }
  }

  async getWalletTags(chatId: number, address: string): Promise<string[]> {
    const entry = await this.prisma.watchedWallet.findUnique({
      where: {
        userId_walletAddress: { userId: chatId, walletAddress: address },
      },
      select: { tags: true },
    });
    return entry?.tags ?? [];
  }

  async getWalletsByTag(
    chatId: number,
    tag: string,
  ): Promise<{ address: string; label: string }[]> {
    const normalizedTag = tag.toLowerCase().trim();
    const wallets = await this.prisma.watchedWallet.findMany({
      where: {
        userId: chatId,
        tags: {
          has: normalizedTag,
        },
      },
      select: { walletAddress: true, label: true },
    });
    return wallets.map((w) => ({
      address: w.walletAddress,
      label: w.label ?? '',
    }));
  }

  async getAllTags(chatId: number): Promise<string[]> {
    const wallets = await this.prisma.watchedWallet.findMany({
      where: { userId: chatId },
      select: { tags: true },
    });
    const allTags = new Set<string>();
    wallets.forEach((w) => w.tags.forEach((t) => allTags.add(t)));
    return Array.from(allTags).sort();
  }

  // ─── Chain Detection ─────────────────────────────────────────────────────────

  detectChain(
    address: string,
  ): 'solana' | 'ethereum' | 'bitcoin' | 'tron' | 'bnb' | 'unknown' {
    const trimmed = address.trim();

    // Ethereum / BNB / EVM — starts with 0x, 42 chars
    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return 'ethereum';

    // Bitcoin — starts with 1, 3, or bc1
    if (
      /^(1|3)[a-zA-Z0-9]{25,34}$/.test(trimmed) ||
      /^bc1[a-zA-Z0-9]{6,87}$/.test(trimmed)
    )
      return 'bitcoin';

    // Tron — starts with T, 34 chars
    if (/^T[a-zA-Z0-9]{33}$/.test(trimmed)) return 'tron';

    // Solana — base58, 32-44 chars, no 0/O/I/l
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
      try {
        new PublicKey(trimmed);
        return 'solana';
      } catch {
        /* fall through */
      }
    }

    return 'unknown';
  }

  chainErrorMessage(address: string): string | null {
    const chain = this.detectChain(address);
    if (chain === 'solana') return null; // valid, no error

    const chainNames: Record<string, string> = {
      ethereum: '⟠ Ethereum / EVM (MetaMask address)',
      bitcoin: '₿ Bitcoin',
      tron: '🔺 Tron',
    };

    const detected = chainNames[chain] ?? '❓ Unknown chain';
    return (
      `⛔ <b>That's not a Solana wallet</b>\n\n` +
      `Detected: <b>${detected}</b>\n\n` +
      `Real-time <b>wallet tracking</b> is Solana-only for now.\n` +
      `(EVM token info cards work — just paste an <code>0x…</code> contract in a group.)\n\n` +
      `Solana addresses look like:\n<code>EizqmoCSovbTzuSnmxkdaJwLBBZgyB2GyjN3m3uJWXpZ</code>`
    );
  }

  // ─── EVM Multi-Chain Support (token info cards only) ─────────────────────────
  //
  // Token cards work on any chain DexScreener indexes. EVM addresses (0x…) are
  // ambiguous across chains, so the *actual* chain is resolved from DexScreener
  // at fetch time (see getTokenInfo) — this table only supplies the per-chain
  // links/labels once we know which chain a token lives on.
  private static readonly EVM_CHAINS: Record<
    string,
    {
      name: string;
      badge: string;
      explorer: string;
      bullxId: string;
      gmgn?: string;
      honeypot?: string;
    }
  > = {
    ethereum: {
      name: 'Ethereum',
      badge: '⟠ Ethereum',
      explorer: 'https://etherscan.io',
      bullxId: '1',
      gmgn: 'eth',
      honeypot: 'ethereum',
    },
    bsc: {
      name: 'BSC',
      badge: '🟡 BSC',
      explorer: 'https://bscscan.com',
      bullxId: '56',
      gmgn: 'bsc',
      honeypot: 'bsc',
    },
    base: {
      name: 'Base',
      badge: '🔵 Base',
      explorer: 'https://basescan.org',
      bullxId: '8453',
      gmgn: 'base',
      honeypot: 'base',
    },
    arbitrum: {
      name: 'Arbitrum',
      badge: '🔷 Arbitrum',
      explorer: 'https://arbiscan.io',
      bullxId: '42161',
    },
  };

  isEvmAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test((address ?? '').trim());
  }

  /**
   * Canonical form of an address for storage & equality. EVM addresses are
   * case-insensitive, so we lowercase them — this keeps first-caller lookups
   * and MC-map keys consistent no matter how a user typed/checksummed the CA.
   * Solana (base58) is case-sensitive and returned untouched.
   */
  normalizeAddress(address: string): string {
    const trimmed = (address ?? '').trim();
    return this.isEvmAddress(trimmed) ? trimmed.toLowerCase() : trimmed;
  }

  // ─── Cached SOL Price ────────────────────────────────────────────────────────

  /**
   * Returns SOL USD price (and 24h change if available), cached in-memory for
   * ~30s. CoinGecko free tier rate-limits aggressively, and handleTransaction
   * fires on every trade — without this cache we get 429s under any real load.
   */
  async getSolPrice(): Promise<{ price: number; change24h: number }> {
    const now = Date.now();
    if (
      this.solPriceCache &&
      now - this.solPriceCache.fetchedAt < SolanaService.SOL_PRICE_TTL_MS
    ) {
      return {
        price: this.solPriceCache.price,
        change24h: this.solPriceCache.change24h,
      };
    }
    try {
      const p = await (
        await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true',
        )
      ).json();
      const price = p?.solana?.usd ?? 0;
      const change24h = p?.solana?.usd_24h_change ?? 0;
      if (price > 0) {
        this.solPriceCache = { price, change24h, fetchedAt: now };
      }
      return { price, change24h };
    } catch {
      // Return stale cache on error rather than 0 — it's better than nothing.
      if (this.solPriceCache)
        return {
          price: this.solPriceCache.price,
          change24h: this.solPriceCache.change24h,
        };
      return { price: 0, change24h: 0 };
    }
  }

  // ─── Trade Deep-Link Buttons ─────────────────────────────────────────────────

  /**
   * Builds inline keyboard rows with one-tap "trade this" deep-links to the
   * biggest Solana trading platforms plus chart / on-chain research links.
   * Referral codes are pulled from env vars (TROJAN_REF / BULLX_REF / PHOTON_REF)
   * when present, otherwise plain links are used.
   */
  buildTradeButtons(
    mint: string | null,
    signature?: string,
    walletAddress?: string,
    chain: string = 'solana',
  ): { text: string; url: string }[][] {
    if (!mint) {
      const contextOnly: { text: string; url: string }[] = [];
      if (signature)
        contextOnly.push({
          text: '🔗 TX',
          url: `https://solscan.io/tx/${signature}`,
        });
      if (walletAddress)
        contextOnly.push({
          text: '👛 Wallet',
          url: `https://solscan.io/account/${walletAddress}`,
        });
      return contextOnly.length ? [contextOnly] : [];
    }

    // EVM tokens (ETH / BSC / Base / Arbitrum) get their own bot + research set;
    // the Solana bots (Trojan/Photon) don't work cross-chain.
    const evm = SolanaService.EVM_CHAINS[chain];
    if (evm) return this.buildEvmTradeButtons(mint, chain, evm);

    const trojanRef = this.config.get<string>('TROJAN_REF', '');
    const bullxRef = this.config.get<string>('BULLX_REF', '');
    const photonRef = this.config.get<string>('PHOTON_REF', '');

    const trojanUrl = trojanRef
      ? `https://t.me/solana_trojanbot?start=r-${trojanRef}-${mint}`
      : `https://t.me/solana_trojanbot?start=${mint}`;

    const bullxUrl = bullxRef
      ? `https://neo.bullx.io/terminal?chainId=1399811149&address=${mint}&referralCode=${bullxRef}`
      : `https://neo.bullx.io/terminal?chainId=1399811149&address=${mint}`;

    // Photon's referral scheme: /@<ref>/<mint>. Without a ref, use the plain
    // token page which accepts a mint or pair address.
    const photonUrl = photonRef
      ? `https://photon-sol.tinyastro.io/@${photonRef}/${mint}`
      : `https://photon-sol.tinyastro.io/en/lp/${mint}`;

    const tradeRow = [
      { text: '⚡ Trojan', url: trojanUrl },
      { text: '🐂 BullX', url: bullxUrl },
      { text: '⚛️ Photon', url: photonUrl },
    ];

    const researchRow: { text: string; url: string }[] = [
      { text: '📊 Chart', url: `https://dexscreener.com/solana/${mint}` },
      { text: '🧬 GMGN', url: `https://gmgn.ai/sol/token/${mint}` },
    ];
    if (signature)
      researchRow.push({
        text: '🔗 TX',
        url: `https://solscan.io/tx/${signature}`,
      });
    if (walletAddress)
      researchRow.push({
        text: '👛 Wallet',
        url: `https://solscan.io/account/${walletAddress}`,
      });

    return [tradeRow, researchRow];
  }

  private buildEvmTradeButtons(
    mint: string,
    chain: string,
    evm: (typeof SolanaService.EVM_CHAINS)[string],
  ): { text: string; url: string }[][] {
    const bullxRef = this.config.get<string>('BULLX_REF', '');

    // Maestro & Banana Gun are multi-chain EVM sniper bots; passing the contract
    // as the /start payload opens each bot focused on this token (they
    // auto-detect the chain). Canonical bot handles below.
    const maestroUrl = `https://t.me/MaestroSniperBot?start=${mint}`;
    const bananaUrl = `https://t.me/BananaGunSniper_bot?start=${mint}`;
    const bullxUrl = bullxRef
      ? `https://neo.bullx.io/terminal?chainId=${evm.bullxId}&address=${mint}&referralCode=${bullxRef}`
      : `https://neo.bullx.io/terminal?chainId=${evm.bullxId}&address=${mint}`;

    const tradeRow = [
      { text: '🤖 Maestro', url: maestroUrl },
      { text: '🍌 Banana', url: bananaUrl },
      { text: '🐂 BullX', url: bullxUrl },
    ];

    const researchRow: { text: string; url: string }[] = [
      { text: '📊 Chart', url: `https://dexscreener.com/${chain}/${mint}` },
    ];
    if (evm.gmgn)
      researchRow.push({
        text: '🧬 GMGN',
        url: `https://gmgn.ai/${evm.gmgn}/token/${mint}`,
      });
    if (evm.honeypot)
      researchRow.push({
        text: '🍯 Honeypot',
        url: `https://honeypot.is/${evm.honeypot}?address=${mint}`,
      });
    researchRow.push({
      text: '🔎 Scan',
      url: `${evm.explorer}/token/${mint}`,
    });

    return [tradeRow, researchRow];
  }

  // ─── Min Trade Filter ────────────────────────────────────────────────────────

  async setMinTradeSize(chatId: number, usd: number): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: chatId },
      create: { id: chatId, minTradeSize: usd },
      update: { minTradeSize: usd },
    });
  }

  async getMinTradeSize(chatId: number): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: chatId },
      select: { minTradeSize: true },
    });
    return user?.minTradeSize ?? 0;
  }

  // ─── Pause / Unpause ─────────────────────────────────────────────────────────

  async pauseWallet(chatId: number, address: string): Promise<boolean> {
    const result = await this.prisma.watchedWallet.updateMany({
      where: { userId: chatId, walletAddress: address },
      data: { paused: true },
    });
    return result.count > 0;
  }

  async unpauseWallet(chatId: number, address: string): Promise<boolean> {
    const result = await this.prisma.watchedWallet.updateMany({
      where: { userId: chatId, walletAddress: address },
      data: { paused: false },
    });
    return result.count > 0;
  }

  async isWalletPaused(chatId: number, address: string): Promise<boolean> {
    const row = await this.prisma.watchedWallet.findUnique({
      where: {
        userId_walletAddress: { userId: chatId, walletAddress: address },
      },
      select: { paused: true },
    });
    return row?.paused ?? false;
  }

  async setWalletMinTradeSize(
    chatId: number,
    address: string,
    usd: number | null,
  ): Promise<boolean> {
    const result = await this.prisma.watchedWallet.updateMany({
      where: { userId: chatId, walletAddress: address },
      data: { minTradeSize: usd },
    });
    return result.count > 0;
  }

  async getWalletMinTradeSize(
    chatId: number,
    address: string,
  ): Promise<number | null> {
    const row = await this.prisma.watchedWallet.findUnique({
      where: {
        userId_walletAddress: { userId: chatId, walletAddress: address },
      },
      select: { minTradeSize: true },
    });
    return row?.minTradeSize ?? null;
  }

  // ─── User Tracking ───────────────────────────────────────────────────────────

  async trackUser(chatId: number, username: string): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: chatId },
      create: { id: chatId, username },
      update: { username, lastSeen: new Date() },
    });
  }

  async getStats(): Promise<string> {
    const totalUsers = await this.prisma.user.count();
    const totalWallets = await this.prisma.wallet.count();
    const activeWatchers = await this.prisma.watchedWallet.groupBy({
      by: ['userId'],
    });

    const uptimeMs = Date.now() - startTime.getTime();
    const hours = Math.floor(uptimeMs / 3600000);
    const minutes = Math.floor((uptimeMs % 3600000) / 60000);

    return [
      `┌─────────────────────────────`,
      `│ 📊 <b>BOT STATS</b>`,
      `└─────────────────────────────\n`,
      `👥 Total users: <b>${totalUsers}</b>`,
      `👁 Active watchers: <b>${activeWatchers.length}</b>`,
      `👛 Wallets being tracked: <b>${totalWallets}</b>`,
      `⏱ Uptime: <b>${hours}h ${minutes}m</b>`,
    ].join('\n');
  }

  // ─── Portfolio ───────────────────────────────────────────────────────────────

  async getPortfolio(address: string): Promise<string> {
    try {
      new PublicKey(address);
    } catch {
      throw new Error('invalid_address');
    }

    const dasRes = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: address,
            page: 1,
            limit: 50,
            displayOptions: { showFungible: true, showNativeBalance: true },
          },
        }),
      },
    );

    const dasData = await dasRes.json();
    const items: any[] = dasData?.result?.items || [];
    const nativeBalance = dasData?.result?.nativeBalance;

    const { price: solPrice, change24h: solChange24h } =
      await this.getSolPrice();

    const solBalance = (nativeBalance?.lamports ?? 0) / 1e9;
    const solUsd = solBalance * solPrice;

    const tokens = items.filter(
      (i) =>
        (i.interface === 'FungibleToken' || i.interface === 'FungibleAsset') &&
        (i.token_info?.balance ?? 0) > 0,
    );

    let totalUsd = solUsd;
    const tokenData = tokens.map((token) => {
      const info = token.token_info;
      const uiBalance =
        (info?.balance ?? 0) / Math.pow(10, info?.decimals ?? 0);
      const pricePerToken = info?.price_info?.price_per_token ?? 0;
      const usdValue = uiBalance * pricePerToken;
      totalUsd += usdValue;
      return {
        symbol: token.content?.metadata?.symbol || info?.symbol || '???',
        uiBalance,
        pricePerToken,
        usdValue,
        mint: token.id as string,
      };
    });

    if (tokens.length === 0 && solBalance === 0)
      return '📭 This wallet appears to be empty.';

    tokenData.sort((a, b) => b.usdValue - a.usdValue);

    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    const chg = solChange24h >= 0;
    const lines: string[] = [
      `┌─────────────────────────────`,
      `│ 💼 <b>PORTFOLIO SNAPSHOT</b>`,
      `│ 👛 <a href="https://solscan.io/account/${address}">${short}</a>`,
      `│ 💵 Total Value: <b>$${totalUsd.toFixed(2)}</b>`,
      `│ 🗂 Assets: ${tokenData.length + 1}`,
      `└─────────────────────────────\n`,
      `◎ <b>SOL</b>  ${this.bar(solUsd, totalUsd)}`,
      `   💰 ${solBalance.toFixed(4)} SOL  ·  <b>$${solUsd.toFixed(2)}</b>`,
      `   📊 $${solPrice.toFixed(2)} per SOL  ${chg ? '📈' : '📉'} <b>${chg ? '+' : ''}${solChange24h.toFixed(2)}%</b> 24h`,
      `   📐 ${totalUsd > 0 ? ((solUsd / totalUsd) * 100).toFixed(1) : 0}% of portfolio\n`,
    ];

    for (const t of tokenData) {
      const pct =
        totalUsd > 0 ? ((t.usdValue / totalUsd) * 100).toFixed(1) : '0.0';
      const price =
        t.pricePerToken > 0
          ? `$${t.pricePerToken < 0.0001 ? t.pricePerToken.toExponential(2) : t.pricePerToken.toFixed(4)}`
          : 'no price';
      const value =
        t.usdValue > 0 ? `<b>$${t.usdValue.toFixed(2)}</b>` : '<i>unknown</i>';
      const mintShort = `${t.mint.slice(0, 4)}...${t.mint.slice(-4)}`;

      lines.push(
        `🪙 <b>${t.symbol}</b>  ${this.bar(t.usdValue, totalUsd)}`,
        `   💰 ${t.uiBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}  ·  ${value}`,
        `   📊 ${price} per token  ·  📐 ${pct}%`,
        `   � <a href="https://solscan.io/token/${t.mint}">${mintShort}</a>  ·  <a href="https://dexscreener.com/solana/${t.mint}">Chart</a>\n`,
      );
    }

    lines.push(
      `� <a href="https://solscan.io/account/${address}">Full wallet on Solscan</a>`,
    );
    return lines.join('\n');
  }

  // ─── TX History ──────────────────────────────────────────────────────────────

  async getTxHistory(address: string): Promise<string> {
    try {
      new PublicKey(address);
    } catch {
      throw new Error('invalid_address');
    }

    const sigsRes = await this.connection.getSignaturesForAddress(
      new PublicKey(address),
      { limit: 10 },
    );

    if (!sigsRes.length) return '📭 No recent transactions found.';

    // Fetch SOL price once for USD conversion (30s cache)
    const solPrice = (await this.getSolPrice()).price;

    // Fetch full tx details for all signatures in parallel
    const txs = await Promise.all(
      sigsRes.map((s) =>
        this.connection
          .getParsedTransaction(s.signature, {
            maxSupportedTransactionVersion: 0,
          })
          .catch(() => null),
      ),
    );

    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    const lines: string[] = [
      `┌─────────────────────────────`,
      `│ 📜 <b>TX HISTORY</b>`,
      `│ 👛 <a href="https://solscan.io/account/${address}">${short}</a>`,
      `│ Last ${sigsRes.length} transactions`,
      `└─────────────────────────────\n`,
    ];

    for (let i = 0; i < sigsRes.length; i++) {
      const sig = sigsRes[i];
      const tx = txs[i];

      const time = sig.blockTime
        ? new Date(sig.blockTime * 1000).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'Unknown time';

      const status = sig.err ? '❌' : '✅';
      const sigShort = `${sig.signature.slice(0, 8)}...${sig.signature.slice(-6)}`;

      let typeLabel = '↔️ Transaction';
      let detailLines: string[] = [];

      if (tx && !sig.err) {
        const accountKeys = tx.transaction.message.accountKeys;
        const walletIndex = accountKeys.findIndex(
          (k: any) =>
            k.pubkey?.toString() === address || k.toString() === address,
        );

        if (walletIndex !== -1) {
          const solChange =
            ((tx.meta?.postBalances?.[walletIndex] ?? 0) -
              (tx.meta?.preBalances?.[walletIndex] ?? 0)) /
            1e9;

          const pre = tx.meta?.preTokenBalances || [];
          const post = tx.meta?.postTokenBalances || [];

          // Find changed token (existing or new)
          const changed =
            post.find(
              (p) =>
                p.owner === address &&
                pre.some(
                  (r) =>
                    r.mint === p.mint &&
                    r.uiTokenAmount.uiAmount !== p.uiTokenAmount.uiAmount,
                ),
            ) ||
            post.find(
              (p) =>
                p.owner === address &&
                !pre.some((r) => r.mint === p.mint && r.owner === address),
            );

          const isBuy = solChange < -0.001;
          const isSell = solChange > 0.001;

          if ((isBuy || isSell) && changed) {
            typeLabel = isBuy ? '🟢 BUY' : '🔴 SELL';
            const solAmt = Math.abs(solChange);
            const usdAmt = solAmt * solPrice;
            const preEntry = pre.find(
              (r) => r.mint === changed.mint && r.owner === address,
            );
            const tokenAmt = Math.abs(
              (changed.uiTokenAmount.uiAmount ?? 0) -
                (preEntry?.uiTokenAmount.uiAmount ?? 0),
            );
            const mintShort = `${changed.mint.slice(0, 6)}...${changed.mint.slice(-4)}`;
            const pricePerToken = tokenAmt > 0 ? usdAmt / tokenAmt : 0;

            detailLines = [
              `   🪙 <a href="https://dexscreener.com/solana/${changed.mint}">${mintShort}</a>`,
              `   💰 ${tokenAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens`,
              `   ◎ ${solAmt.toFixed(4)} SOL  ·  <b>~$${usdAmt.toFixed(2)}</b>`,
              pricePerToken > 0
                ? `   📊 $${pricePerToken < 0.0001 ? pricePerToken.toExponential(3) : pricePerToken.toFixed(6)} per token`
                : '',
            ].filter(Boolean);
          } else if (Math.abs(solChange) > 0.000001 && !changed) {
            typeLabel = solChange > 0 ? '📥 Received' : '📤 Sent';
            detailLines = [
              `   ◎ ${Math.abs(solChange).toFixed(4)} SOL  ·  <b>~$${(Math.abs(solChange) * solPrice).toFixed(2)}</b>`,
            ];
          }
        }
      }

      lines.push(`<b>${i + 1}.</b> ${status} ${typeLabel}  ·  🕐 ${time}`);
      lines.push(...detailLines);
      lines.push(
        `   🔗 <a href="https://solscan.io/tx/${sig.signature}">${sigShort}</a>\n`,
      );
    }

    return lines.join('\n');
  }

  // ─── Group Token Calls ───────────────────────────────────────────────────────

  async recordGroupTokenCall(
    groupId: number,
    mint: string,
    symbol: string,
    name: string,
    caller?: {
      id: number;
      username: string;
      priceAtCall: number;
      mcAtCall: number;
    },
  ): Promise<void> {
    await this.prisma.groupTokenCall.create({
      data: {
        groupId,
        mint,
        symbol,
        name,
        callerId: caller?.id ?? 0,
        callerUsername: caller?.username ?? '',
        priceAtCall: caller?.priceAtCall ?? 0,
        mcAtCall: caller?.mcAtCall ?? 0,
      },
    });
  }

  /**
   * Returns the truly earliest call for this mint in this group, regardless
   * of whether the caller was recorded. Consumer must handle callerId=0 as
   * "unknown caller" (legacy pre-Phase-1 rows). Fixes a bug where filtering
   * out callerId=0 meant a later real-user call could be misreported as first.
   */
  async getFirstCaller(
    groupId: number,
    mint: string,
  ): Promise<{
    callerId: number;
    callerUsername: string;
    priceAtCall: number;
    mcAtCall: number;
    calledAt: Date;
  } | null> {
    const first = await this.prisma.groupTokenCall.findFirst({
      where: { groupId, mint },
      orderBy: { calledAt: 'asc' },
      select: {
        callerId: true,
        callerUsername: true,
        priceAtCall: true,
        mcAtCall: true,
        calledAt: true,
      },
    });
    if (!first) return null;
    return {
      callerId: Number(first.callerId),
      callerUsername: first.callerUsername,
      priceAtCall: first.priceAtCall,
      mcAtCall: first.mcAtCall,
      calledAt: first.calledAt,
    };
  }

  /**
   * Batched current market cap lookup via DexScreener. Returns a map of
   * mint → marketCap USD. Silently drops mints with no active pair.
   * DexScreener caps at 30 addresses per request; we chunk larger lists.
   */
  async getCurrentMarketCaps(mints: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (mints.length === 0) return out;
    const unique = Array.from(new Set(mints));
    const CHUNK = 30;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      try {
        // Chain-agnostic endpoint — returns pairs for these addresses across
        // every chain (Solana + EVM), so mixed-chain call lists resolve in one
        // request. `baseToken.address` is normalized to match how we store it.
        const r = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${slice.join(',')}`,
        );
        const data = await r.json();
        const pairs: any[] = data?.pairs ?? [];
        for (const pair of pairs) {
          const addr = pair?.baseToken?.address
            ? this.normalizeAddress(pair.baseToken.address)
            : null;
          const fdv = pair?.fdv ?? 0;
          if (!addr) continue;
          // Keep the largest FDV across pools for the same mint.
          const prev = out.get(addr) ?? 0;
          if (fdv > prev) out.set(addr, fdv);
        }
      } catch {
        /* best effort */
      }
    }
    return out;
  }

  async getGroupLeaderboard(groupId: number): Promise<
    {
      callerId: number;
      username: string;
      calls: number;
      avgPeakGainPct: number;
      avgNowGainPct: number;
      bestPeakGainPct: number;
      winRate: number; // fraction of calls with >= 100% peak gain (2x+)
    }[]
  > {
    // Fetch ALL calls (including anonymous pre-Phase-1 rows) so we can tell
    // whether the truly earliest call for each mint was anonymous.
    const rows = await this.prisma.groupTokenCall.findMany({
      where: { groupId },
      orderBy: { calledAt: 'asc' },
      select: {
        callerId: true,
        callerUsername: true,
        mint: true,
        mcAtCall: true,
      },
    });
    if (rows.length === 0) return [];

    // For each mint, look at its truly-earliest call:
    // - Skip mints whose first call was anonymous (callerId=0) — we can't
    //   credit a later caller who didn't discover it.
    // - Skip mints without a recorded mcAtCall (can't score).
    const firstPerMint = new Map<
      string,
      { callerId: bigint; username: string; mcAtCall: number }
    >();
    for (const r of rows) {
      if (firstPerMint.has(r.mint)) continue;
      if (r.callerId === BigInt(0)) {
        // Mark as "poisoned" — later calls for this mint should be skipped too.
        firstPerMint.set(r.mint, {
          callerId: BigInt(0),
          username: '',
          mcAtCall: 0,
        });
        continue;
      }
      if (r.mcAtCall <= 0) continue;
      firstPerMint.set(r.mint, {
        callerId: r.callerId,
        username: r.callerUsername,
        mcAtCall: r.mcAtCall,
      });
    }
    // Drop poisoned entries.
    for (const [mint, v] of firstPerMint) {
      if (v.callerId === BigInt(0)) firstPerMint.delete(mint);
    }
    if (firstPerMint.size === 0) return [];

    const mints = Array.from(firstPerMint.keys());

    // Prefer stored peak MCs; fall back to current MC lookup for any missing.
    const peaks = await this.prisma.tokenPeak.findMany({
      where: { mint: { in: mints } },
      select: { mint: true, peakMcUsd: true, lastMcUsd: true },
    });
    const peakByMint = new Map<string, { peak: number; last: number }>();
    for (const p of peaks) {
      peakByMint.set(p.mint, { peak: p.peakMcUsd, last: p.lastMcUsd });
    }
    const missing = mints.filter((m) => !peakByMint.has(m));
    if (missing.length > 0) {
      const liveMcs = await this.getCurrentMarketCaps(missing);
      for (const [m, mc] of liveMcs) {
        peakByMint.set(m, { peak: mc, last: mc });
      }
    }

    // Aggregate per caller — track BOTH peak gain (best-case since call) and
    // current gain (right-now).
    const perCaller = new Map<
      string,
      {
        callerId: number;
        username: string;
        peakGains: number[];
        nowGains: number[];
      }
    >();
    for (const [mint, first] of firstPerMint) {
      const stats = peakByMint.get(mint);
      if (!stats) continue;
      const peakGainPct =
        ((Math.max(stats.peak, stats.last) - first.mcAtCall) / first.mcAtCall) *
        100;
      const nowGainPct = ((stats.last - first.mcAtCall) / first.mcAtCall) * 100;
      const key = String(first.callerId);
      const entry = perCaller.get(key) ?? {
        callerId: Number(first.callerId),
        username: first.username,
        peakGains: [],
        nowGains: [],
      };
      entry.peakGains.push(peakGainPct);
      entry.nowGains.push(nowGainPct);
      if (first.username && !entry.username) entry.username = first.username;
      perCaller.set(key, entry);
    }

    const results = Array.from(perCaller.values())
      .map((c) => {
        const calls = c.peakGains.length;
        const avgPeakGainPct = c.peakGains.reduce((s, g) => s + g, 0) / calls;
        const avgNowGainPct = c.nowGains.reduce((s, g) => s + g, 0) / calls;
        const bestPeakGainPct = Math.max(...c.peakGains);
        const wins = c.peakGains.filter((g) => g >= 100).length;
        return {
          callerId: c.callerId,
          username: c.username,
          calls,
          avgPeakGainPct,
          avgNowGainPct,
          bestPeakGainPct,
          winRate: wins / calls,
        };
      })
      .sort((a, b) => b.avgPeakGainPct - a.avgPeakGainPct);

    return results;
  }

  async getTrendingTokens(
    groupId: number,
  ): Promise<{ mint: string; symbol: string; name: string; count: number }[]> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const calls = await this.prisma.groupTokenCall.findMany({
      where: { groupId, calledAt: { gte: since } },
      orderBy: { calledAt: 'desc' },
    });

    // Group by mint — prefer entry with a real symbol, count all
    const map = new Map<
      string,
      { symbol: string; name: string; count: number }
    >();
    for (const c of calls) {
      const existing = map.get(c.mint);
      if (existing) {
        existing.count++;
        // upgrade symbol/name if we now have a better one
        if (!existing.symbol && c.symbol) existing.symbol = c.symbol;
        if (!existing.name && c.name) existing.name = c.name;
      } else {
        map.set(c.mint, { symbol: c.symbol, name: c.name, count: 1 });
      }
    }

    const results = Array.from(map.entries())
      .map(([mint, v]) => ({ mint, ...v }))
      .sort((a, b) => b.count - a.count);

    // For any token still missing a symbol, fetch it live from DexScreener
    await Promise.all(
      results
        .filter((t) => !t.symbol)
        .map(async (t) => {
          try {
            const r = await fetch(
              `https://api.dexscreener.com/latest/dex/tokens/${t.mint}`,
            );
            const d = await r.json();
            const pair = (d?.pairs ?? []).find(
              (p: any) => p?.baseToken?.symbol,
            );
            if (pair) {
              t.symbol = pair.baseToken.symbol ?? '';
              t.name = pair.baseToken.name ?? '';
              // backfill DB so next time it's already there
              await this.prisma.groupTokenCall.updateMany({
                where: { groupId, mint: t.mint, symbol: '' },
                data: { symbol: t.symbol, name: t.name },
              });
            }
          } catch {
            /* best effort */
          }
        }),
    );

    return results;
  }

  // ─── Token Info Card ─────────────────────────────────────────────────────────

  async getTokenInfo(mint: string): Promise<{
    text: string;
    imageUrl: string | null;
    symbol: string;
    name: string;
    price: number;
    marketCap: number;
    chain: string;
  }> {
    const isEvm = this.isEvmAddress(mint);

    // DexScreener is cross-chain. Helius (getAsset) and RugCheck are Solana-only,
    // so we skip them for EVM tokens and lean on DexScreener alone there.
    const [dsRes, heliusRes, rugRes] = await Promise.allSettled([
      fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`).then((r) =>
        r.json(),
      ),
      isEvm
        ? Promise.resolve(null)
        : fetch(`https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'getAsset',
              params: { id: mint },
            }),
          }).then((r) => r.json()),
      isEvm
        ? Promise.resolve(null)
        : fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`).then((r) =>
            r.json(),
          ),
    ]);

    const ds = dsRes.status === 'fulfilled' ? dsRes.value : null;
    const helius = heliusRes.status === 'fulfilled' ? heliusRes.value : null;
    const rug = rugRes.status === 'fulfilled' ? rugRes.value : null;

    // Pick the most liquid pair. For an EVM address DexScreener may return pairs
    // for the same token across several chains — restrict to the one the token
    // actually trades on (whichever has the deepest liquidity).
    const allPairs: any[] = ds?.pairs ?? [];
    const pairs = isEvm
      ? allPairs.filter((p: any) =>
          SolanaService.EVM_CHAINS[p?.chainId ?? ''] ? true : false,
        )
      : allPairs.filter((p: any) => (p?.chainId ?? 'solana') === 'solana');
    const pair = (pairs.length ? pairs : allPairs).sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
    )[0];

    if (!pair) {
      return {
        text: `❌ No trading data found for this token.\n\nThis address may not be a tradeable token, or it has no active liquidity pool on any DEX yet.`,
        imageUrl: null,
        symbol: '',
        name: '',
        price: 0,
        marketCap: 0,
        chain: isEvm ? 'ethereum' : 'solana',
      };
    }

    const chain: string = pair.chainId ?? (isEvm ? 'ethereum' : 'solana');
    const evmMeta = SolanaService.EVM_CHAINS[chain];

    const token = pair.baseToken ?? {};
    const name = token.name || helius?.result?.content?.metadata?.name || '???';
    const symbol =
      token.symbol || helius?.result?.content?.metadata?.symbol || '???';
    const price: number = parseFloat(pair.priceUsd ?? '0');
    const mc: number = pair.fdv ?? 0;
    const vol24: number = pair.volume?.h24 ?? 0;
    const liq: number = pair.liquidity?.usd ?? 0;
    const priceChange1h: number = pair.priceChange?.h1 ?? 0;
    const priceChange24h: number = pair.priceChange?.h24 ?? 0;
    const dex = pair.dexId ?? '';
    const pairAddr = pair.pairAddress ?? '';

    // Supply from Helius (Solana). For EVM — or when Helius has no data — fall
    // back to FDV/price, which equals total supply.
    const tokenInfo = helius?.result?.token_info;
    const supply: number = tokenInfo?.supply
      ? tokenInfo.supply / Math.pow(10, tokenInfo.decimals ?? 0)
      : price > 0 && mc > 0
        ? mc / price
        : 0;

    // Image
    const imageUrl: string | null =
      helius?.result?.content?.links?.image ||
      helius?.result?.content?.files?.[0]?.uri ||
      pair.info?.imageUrl ||
      null;

    const fmt = (n: number) =>
      n >= 1_000_000_000
        ? `$${(n / 1_000_000_000).toFixed(2)}B`
        : n >= 1_000_000
          ? `$${(n / 1_000_000).toFixed(2)}M`
          : n >= 1_000
            ? `$${(n / 1_000).toFixed(1)}K`
            : `$${n.toFixed(2)}`;

    const fmtPrice = (p: number) =>
      p === 0
        ? '$0'
        : p < 0.000001
          ? `$${p.toExponential(3)}`
          : p < 0.01
            ? `$${p.toFixed(8)}`
            : `$${p.toFixed(4)}`;

    const changeStr = (c: number) =>
      c >= 0 ? `🟢 +${c.toFixed(1)}%` : `🔴 ${c.toFixed(1)}%`;

    const supplyFmt =
      supply > 0
        ? supply >= 1_000_000_000
          ? `${(supply / 1_000_000_000).toFixed(2)}B`
          : supply >= 1_000_000
            ? `${(supply / 1_000_000).toFixed(2)}M`
            : supply.toLocaleString(undefined, { maximumFractionDigits: 0 })
        : 'N/A';

    // Security from RugCheck
    const topHolders: any[] = rug?.topHolders ?? [];
    const top10Pct = topHolders
      .slice(0, 10)
      .reduce((s: number, h: any) => s + (h.pct ?? 0), 0);
    const top10Count = topHolders.slice(0, 10).length;
    const totalHolders: number = rug?.totalHolders ?? 0;
    const mintAuthority = rug?.mintAuthority ?? rug?.token?.mintAuthority;
    const freezeAuthority = rug?.freezeAuthority ?? rug?.token?.freezeAuthority;
    const creatorBalance: number = rug?.creatorBalance ?? 0;
    const devSold = creatorBalance === 0;
    const risks: any[] = rug?.risks ?? [];
    const dexPaid = !risks.some(
      (r: any) =>
        r.name?.toLowerCase().includes('dex') &&
        r.name?.toLowerCase().includes('not paid'),
    );
    const rugScore: number = rug?.score_normalised ?? rug?.score ?? 0;
    const rugLink = `https://rugcheck.xyz/tokens/${mint}`;

    const securityLine = rug
      ? `\n🔒 <b>Security</b>\n` +
        `├ Mint Auth  ${mintAuthority ? '🔴 Enabled' : '🟢 Disabled'}\n` +
        `├ Freeze     ${freezeAuthority ? '🔴 Enabled' : '🟢 Disabled'}\n` +
        `├ Top 10     <b>${top10Pct.toFixed(1)}%</b> of supply (${top10Count} holders)\n` +
        `├ Holders    <b>${totalHolders.toLocaleString()}</b>\n` +
        `├ Dev Sold   ${devSold ? '🟢 Yes' : '🔴 No'}\n` +
        `├ DEX Paid   ${dexPaid ? '🟢 Yes' : '🔴 No'}\n` +
        `└ <a href="${rugLink}">Full report on RugCheck</a>`
      : '';
    const socials: any[] = pair.info?.socials ?? [];
    const websites: any[] = pair.info?.websites ?? [];
    const twitter = socials.find((s: any) => s.type === 'twitter')?.url ?? null;
    const telegram =
      socials.find((s: any) => s.type === 'telegram')?.url ?? null;
    const website = websites[0]?.url ?? null;

    // Twitter search link
    const twitterQuery = encodeURIComponent(
      `($${symbol} OR ${mint} OR url:${mint})`,
    );
    const twitterSearchUrl = `https://twitter.com/search?q=${twitterQuery}&f=live`;

    const socialParts: string[] = [];
    if (twitter) socialParts.push(`<a href="${twitter}">X</a>`);
    if (telegram) socialParts.push(`<a href="${telegram}">TG</a>`);
    if (website) socialParts.push(`<a href="${website}">About</a>`);
    socialParts.push(`<a href="${twitterSearchUrl}">Search X</a>`);

    const socialsLine = `\n🔗 <b>Socials</b>\n└ ${socialParts.join(' • ')}`;

    const chainBadge = evmMeta ? evmMeta.badge : '◎ Solana';

    const text =
      `🪙 <b>${name}</b> (<b>$${symbol}</b>)\n` +
      `<code>${mint}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>Stats</b>\n` +
      `├ USD    <b>${fmtPrice(price)}</b>\n` +
      `├ MC     <b>${fmt(mc)}</b>\n` +
      `├ Vol    <b>${fmt(vol24)}</b>\n` +
      `├ LP     <b>${fmt(liq)}</b>\n` +
      `├ Sup    <b>${supplyFmt}</b>\n` +
      `├ 1H     ${changeStr(priceChange1h)}\n` +
      `└ 24H    ${changeStr(priceChange24h)}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏦 DEX: <b>${dex.toUpperCase()}</b>  ·  ${chainBadge}` +
      socialsLine +
      securityLine;

    return { text, imageUrl, symbol, name, price, marketCap: mc, chain };
  }

  // ─── Price Check ─────────────────────────────────────────────────────────────

  async getTokenPrice(mintOrSymbol: string): Promise<string> {
    // Try Jupiter price API (works with mint addresses and some symbols)
    try {
      const res = await fetch(
        `https://price.jup.ag/v6/price?ids=${mintOrSymbol}`,
      );
      const data = await res.json();
      const entry = data?.data?.[mintOrSymbol];

      if (entry) {
        const price = entry.price as number;
        const id = entry.id as string;
        const idShort =
          id.length > 20 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;

        return [
          `┌─────────────────────────────`,
          `│ 💲 <b>TOKEN PRICE</b>`,
          `│ 🪙 ${mintOrSymbol}`,
          `└─────────────────────────────\n`,
          `💵 Price: <b>$${price < 0.0001 ? price.toExponential(4) : price.toFixed(6)}</b>`,
          `🔗 Mint: <a href="https://solscan.io/token/${id}">${idShort}</a>`,
          `📈 <a href="https://dexscreener.com/solana/${id}">View Chart on DexScreener</a>`,
        ].join('\n');
      }
    } catch {
      /* fall through */
    }

    return `❌ Could not find price for <code>${mintOrSymbol}</code>.\nTry using the full mint address.`;
  }

  // ─── Transaction Handler ─────────────────────────────────────────────────────

  private async handleTransaction(walletAddress: string, signature: string) {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) return;

      const action = this.detectAction(tx, walletAddress);
      if (!action) return;

      // Handle transfer notifications separately
      if (action.type === 'TRANSFER') {
        // Fetch token metadata if it's a token transfer
        if (action.outMint) {
          const meta = await this.fetchTokenMeta(action.outMint);
          action.outName = meta.name || action.outName;
          action.outSymbol = meta.symbol || action.outSymbol;
        }

        const watchers = await this.prisma.watchedWallet.findMany({
          where: { walletAddress },
          include: { user: true },
        });
        for (const watcher of watchers) {
          const chatId = Number(watcher.userId);
          if (watcher.paused) continue;
          const label = watcher.label ?? '';
          const message = this.formatTransferMessage(
            walletAddress,
            signature,
            action,
            label,
          );
          this.bot.telegram
            .sendMessage(chatId, message, {
              parse_mode: 'HTML',
              // @ts-ignore
              disable_web_page_preview: true,
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: 'TX',
                      url: `https://solscan.io/tx/${signature}`,
                    },
                    {
                      text: 'Wallet',
                      url: `https://solscan.io/account/${walletAddress}`,
                    },
                    ...(action.transferTo
                      ? [
                          {
                            text: 'Recipient',
                            url: `https://solscan.io/account/${action.transferTo}`,
                          },
                        ]
                      : []),
                  ],
                ],
              },
            })
            .catch((err) => {
              this.logger.error(`Failed to send to ${chatId}: ${err.message}`);
            });
        }
        return;
      }

      // Fetch current SOL price to calculate USD value of the trade
      const solPrice = (await this.getSolPrice()).price;

      action.usdValue = action.solAmount * solPrice;

      // Fetch token metadata + market price for both sides in parallel
      const [inMeta, outMeta] = await Promise.all([
        action.inMint
          ? this.fetchTokenMeta(action.inMint)
          : Promise.resolve({ name: 'Solana', symbol: 'SOL' }),
        action.outMint
          ? this.fetchTokenMeta(action.outMint)
          : Promise.resolve({ name: 'Solana', symbol: 'SOL' }),
      ]);

      action.inSymbol = inMeta.symbol || action.inSymbol;
      action.inName = inMeta.name || action.inName;
      action.outSymbol = outMeta.symbol || action.outSymbol;
      action.outName = outMeta.name || action.outName;

      // Sync legacy fields
      if (action.tokenMint === action.inMint) {
        action.tokenSymbol = action.inSymbol;
        action.tokenName = action.inName;
      } else if (action.tokenMint === action.outMint) {
        action.tokenSymbol = action.outSymbol;
        action.tokenName = action.outName;
      }

      // Fetch live market price + market cap for the primary (non-SOL) token
      const primaryMint = action.inMint ?? action.outMint;
      let marketPrice = 0;
      let marketCap = 0;
      if (primaryMint) {
        try {
          const jr = await fetch(
            `https://price.jup.ag/v6/price?ids=${primaryMint}`,
          );
          const jd = await jr.json();
          marketPrice = jd?.data?.[primaryMint]?.price ?? 0;
        } catch {
          /* best effort */
        }
        try {
          const dr = await fetch(
            `https://api.dexscreener.com/latest/dex/tokens/${primaryMint}`,
          );
          const dd = await dr.json();
          const pair = (dd?.pairs ?? []).find((p: any) => p?.fdv > 0);
          marketCap = pair?.fdv ?? 0;
        } catch {
          /* best effort */
        }
      }

      // Tx fee in SOL
      const txFeeSol = (tx.meta?.fee ?? 0) / 1e9;
      const txFeeUsd = txFeeSol * solPrice;

      // Tx timestamp
      const txTime = tx.blockTime
        ? new Date(tx.blockTime * 1000).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : null;

      // Price impact: difference between what was paid vs market price
      let priceImpact: number | null = null;
      if (
        marketPrice > 0 &&
        action.inMint &&
        action.inAmount > 0 &&
        action.usdValue > 0
      ) {
        const paidPerToken = action.usdValue / action.inAmount;
        priceImpact = ((paidPerToken - marketPrice) / marketPrice) * 100;
      }

      const entry = this.watchedWallets.get(walletAddress);
      if (!entry) return;

      // ── First-buy detection (per-wallet, computed before we persist this tx)
      // For BUYs: has this wallet ever bought this mint before?
      let isFirstBuy = false;
      if (action.type === 'BUY' && action.inMint) {
        const priorBuy = await this.prisma.trade.findFirst({
          where: {
            walletAddress,
            tokenMint: action.inMint,
            type: 'BUY',
          },
          select: { id: true },
        });
        isFirstBuy = !priorBuy;
      }

      // Fetch all users watching this wallet from DB
      const watchers = await this.prisma.watchedWallet.findMany({
        where: { walletAddress },
        include: { user: true },
      });

      // ── Cluster detection: for each recipient, count how many of THEIR
      // watched wallets have bought this mint in the last 30 min. Only bother
      // computing when this is a BUY of a token mint.
      const CLUSTER_WINDOW_MIN = 30;
      const clusterSince = new Date(
        Date.now() - CLUSTER_WINDOW_MIN * 60 * 1000,
      );
      const insiderSince = new Date(
        Date.now() - SolanaService.INSIDER_WINDOW_SEC * 1000,
      );
      const perUserCluster = new Map<
        number,
        { count: number; windowMinutes: number }
      >();
      if (action.type === 'BUY' && action.inMint) {
        for (const w of watchers) {
          const chatId = Number(w.userId);
          const userWatched = await this.prisma.watchedWallet.findMany({
            where: { userId: w.userId, paused: false },
            select: { walletAddress: true, label: true },
          });
          const addrs = userWatched.map((u) => u.walletAddress);
          if (addrs.length < 2) continue;

          const labelByAddr = new Map(
            userWatched.map((u) => [u.walletAddress, u.label ?? '']),
          );

          // Wide cluster (30 min) — inline "Nth wallet in 30m" line.
          const priorBuys30m = await this.prisma.trade.groupBy({
            by: ['walletAddress'],
            where: {
              walletAddress: { in: addrs, not: walletAddress },
              tokenMint: action.inMint,
              type: 'BUY',
              timestamp: { gte: clusterSince },
            },
          });
          if (priorBuys30m.length >= 1) {
            perUserCluster.set(chatId, {
              count: priorBuys30m.length + 1,
              windowMinutes: CLUSTER_WINDOW_MIN,
            });
          }

          // Tight insider cluster (60s) — separate 🚨 alert. Fires when 3+
          // distinct wallets they track buy the same mint inside the window.
          const priorBuys60s = await this.prisma.trade.findMany({
            where: {
              walletAddress: { in: addrs, not: walletAddress },
              tokenMint: action.inMint,
              type: 'BUY',
              timestamp: { gte: insiderSince },
            },
            select: {
              walletAddress: true,
              timestamp: true,
              totalUsd: true,
              solAmount: true,
            },
            orderBy: { timestamp: 'asc' },
          });
          const buyerSet = new Set(priorBuys60s.map((b) => b.walletAddress));
          buyerSet.add(walletAddress); // include the current trade
          if (buyerSet.size >= SolanaService.INSIDER_MIN_WALLETS) {
            const dedupKey = `${chatId}:${action.inMint}`;
            const lastAlert = this.insiderClusterAlerted.get(dedupKey) ?? 0;
            if (Date.now() - lastAlert >= SolanaService.INSIDER_DEDUP_MS) {
              this.insiderClusterAlerted.set(dedupKey, Date.now());
              this.sendInsiderClusterAlert(chatId, {
                mint: action.inMint,
                symbol:
                  action.inSymbol ||
                  `${action.inMint.slice(0, 4)}...${action.inMint.slice(-4)}`,
                name: action.inName,
                marketCap,
                currentWallet: walletAddress,
                currentUsd: action.usdValue,
                priorBuys: priorBuys60s.map((b) => ({
                  address: b.walletAddress,
                  label: labelByAddr.get(b.walletAddress) ?? '',
                  totalUsd: b.totalUsd,
                  solAmount: b.solAmount,
                  timestamp: b.timestamp,
                })),
                currentLabel: labelByAddr.get(walletAddress) ?? '',
                signature,
              });
            }
          }
        }
      }

      for (const watcher of watchers) {
        const chatId = Number(watcher.userId);
        const min = watcher.minTradeSize ?? watcher.user.minTradeSize;
        if (action.usdValue < min) continue;
        if (watcher.paused) continue;

        const label = watcher.label ?? '';
        const message = this.formatTradeMessage(
          walletAddress,
          signature,
          action,
          label,
          {
            solPrice,
            marketPrice,
            marketCap,
            txFeeSol,
            txFeeUsd,
            txTime,
            priceImpact,
            isFirstBuy,
            cluster: perUserCluster.get(chatId),
          },
        );

        this.bot.telegram
          .sendMessage(chatId, message, {
            parse_mode: 'HTML',
            // @ts-ignore
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: this.buildTradeButtons(
                primaryMint,
                signature,
                walletAddress,
              ),
            },
          })
          .catch((err) => {
            this.logger.error(`Failed to send to ${chatId}: ${err.message}`);
          });
      }

      // Persist the trade — needed for first-buy + cluster + PnL analytics.
      // TRANSFERs return earlier in this method so action.type here is always
      // BUY / SELL / SWAP. Skip if we have no primary mint (unlikely).
      if (primaryMint) {
        const tokenAmount =
          action.type === 'BUY' ? action.inAmount : action.outAmount;
        this.prisma.trade
          .upsert({
            where: { signature },
            create: {
              walletAddress,
              type: action.type,
              tokenMint: primaryMint,
              tokenSymbol: action.tokenSymbol || '',
              tokenName: action.tokenName || '',
              tokenAmount,
              priceUsd: marketPrice,
              totalUsd: action.usdValue,
              marketCapUsd: marketCap,
              solAmount: action.solAmount,
              signature,
              timestamp: tx.blockTime
                ? new Date(tx.blockTime * 1000)
                : new Date(),
            },
            update: {},
          })
          .catch((err) => {
            this.logger.error(
              `Failed to persist trade ${signature}: ${err.message}`,
            );
          });
      }
    } catch (err) {
      this.logger.error(`Error handling tx ${signature}: ${err.message}`);
    }
  }

  // ─── Token Metadata ──────────────────────────────────────────────────────────

  private async fetchTokenMeta(
    mint: string,
  ): Promise<{ name: string; symbol: string }> {
    try {
      const res = await fetch(
        `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getAsset',
            params: { id: mint },
          }),
        },
      );
      const data = await res.json();
      const meta = data?.result?.content?.metadata;
      const info = data?.result?.token_info;
      return {
        name: meta?.name || info?.name || '',
        symbol: meta?.symbol || info?.symbol || '',
      };
    } catch {
      return { name: '', symbol: '' };
    }
  }

  private detectAction(
    tx: ParsedTransactionWithMeta,
    walletAddress: string,
  ): {
    type: 'BUY' | 'SELL' | 'SWAP' | 'TRANSFER';
    // "in" = what the wallet received
    inSymbol: string;
    inName: string;
    inMint: string | null;
    inAmount: number;
    // "out" = what the wallet spent
    outSymbol: string;
    outName: string;
    outMint: string | null;
    outAmount: number;
    usdValue: number;
    // legacy compat
    tokenSymbol: string;
    tokenName: string;
    tokenMint: string;
    tokenAmount: number;
    solAmount: number;
    // transfer-specific
    transferTo?: string;
    transferFrom?: string;
  } | null {
    const accountKeys = tx.transaction.message.accountKeys;
    const walletIndex = accountKeys.findIndex(
      (k: any) =>
        k.pubkey?.toString() === walletAddress ||
        k.toString() === walletAddress,
    );
    if (walletIndex === -1) return null;

    const solChange =
      ((tx.meta?.postBalances?.[walletIndex] ?? 0) -
        (tx.meta?.preBalances?.[walletIndex] ?? 0)) /
      1e9;

    const preTokenBalances = tx.meta?.preTokenBalances || [];
    const postTokenBalances = tx.meta?.postTokenBalances || [];

    // Compute per-mint token delta for this wallet
    const allMints = new Set([
      ...preTokenBalances
        .filter((b) => b.owner === walletAddress)
        .map((b) => b.mint),
      ...postTokenBalances
        .filter((b) => b.owner === walletAddress)
        .map((b) => b.mint),
    ]);

    const tokenDeltas: { mint: string; delta: number }[] = [];
    for (const mint of allMints) {
      const pre = preTokenBalances.find(
        (b) => b.mint === mint && b.owner === walletAddress,
      );
      const post = postTokenBalances.find(
        (b) => b.mint === mint && b.owner === walletAddress,
      );
      const delta =
        (post?.uiTokenAmount.uiAmount ?? 0) -
        (pre?.uiTokenAmount.uiAmount ?? 0);
      if (Math.abs(delta) > 0) tokenDeltas.push({ mint, delta });
    }

    const tokensIn = tokenDeltas.filter((t) => t.delta > 0); // received tokens
    const tokensOut = tokenDeltas.filter((t) => t.delta < 0); // spent tokens
    const solIn = solChange > 0.001;
    const solOut = solChange < -0.001;

    // Nothing meaningful happened
    if (!solIn && !solOut && tokenDeltas.length === 0) return null;

    // Plain SOL transfer (no tokens involved) — detect recipient
    if (tokenDeltas.length === 0) {
      if (!solOut) return null;
      const recipientIndex = (tx.meta?.postBalances ?? []).findIndex(
        (bal, i) =>
          i !== walletIndex &&
          ((tx.meta!.postBalances![i] ?? 0) - (tx.meta!.preBalances![i] ?? 0)) /
            1e9 >
            0.001,
      );
      const transferTo =
        recipientIndex >= 0
          ? ((accountKeys[recipientIndex] as any)?.pubkey?.toString() ??
            accountKeys[recipientIndex]?.toString())
          : undefined;
      return {
        type: 'TRANSFER',
        inMint: null,
        inName: 'Solana',
        inSymbol: 'SOL',
        inAmount: 0,
        outMint: null,
        outName: 'Solana',
        outSymbol: 'SOL',
        outAmount: Math.abs(solChange),
        usdValue: 0,
        tokenMint: '',
        tokenSymbol: 'SOL',
        tokenName: 'Solana',
        tokenAmount: 0,
        solAmount: Math.abs(solChange),
        transferTo,
      };
    }

    // ── Determine IN / OUT sides ──────────────────────────────────────────────

    let inMint: string | null = null;
    let inAmount = 0;
    let outMint: string | null = null;
    let outAmount = 0;

    if (solOut && tokensIn.length > 0) {
      // SOL → Token  (classic BUY)
      const t = tokensIn[0];
      inMint = t.mint;
      inAmount = t.delta;
      outMint = null;
      outAmount = Math.abs(solChange);
    } else if (solIn && tokensOut.length > 0) {
      // Token → SOL  (classic SELL)
      const t = tokensOut[0];
      inMint = null;
      inAmount = solChange;
      outMint = t.mint;
      outAmount = Math.abs(t.delta);
    } else if (tokensIn.length > 0 && tokensOut.length > 0) {
      // Token → Token swap
      inMint = tokensIn[0].mint;
      inAmount = tokensIn[0].delta;
      outMint = tokensOut[0].mint;
      outAmount = Math.abs(tokensOut[0].delta);
    } else if (tokensOut.length > 0) {
      // Token sent out with no swap — transfer out
      const t = tokensOut[0];
      const recipient = postTokenBalances.find(
        (b) => b.mint === t.mint && b.owner !== walletAddress,
      );
      return {
        type: 'TRANSFER',
        inMint: null,
        inName: '',
        inSymbol: 'SOL',
        inAmount: 0,
        outMint: t.mint,
        outName: '',
        outSymbol: t.mint.slice(0, 6) + '...' + t.mint.slice(-4),
        outAmount: Math.abs(t.delta),
        usdValue: 0,
        tokenMint: t.mint,
        tokenSymbol: t.mint.slice(0, 6) + '...' + t.mint.slice(-4),
        tokenName: '',
        tokenAmount: Math.abs(t.delta),
        solAmount: 0,
        transferTo: recipient?.owner,
      };
    } else {
      return null;
    }

    // Classify: SOL out + tokens in = BUY; SOL in + tokens out = SELL; else SWAP.
    let type: 'BUY' | 'SELL' | 'SWAP';
    if (solOut && tokensIn.length > 0 && tokensOut.length === 0) type = 'BUY';
    else if (solIn && tokensOut.length > 0 && tokensIn.length === 0)
      type = 'SELL';
    else type = 'SWAP';

    const shortMint = (m: string) => `${m.slice(0, 6)}...${m.slice(-4)}`;

    return {
      type,
      inMint,
      inName: '',
      inSymbol: inMint ? shortMint(inMint) : 'SOL',
      inAmount,
      outMint,
      outName: '',
      outSymbol: outMint ? shortMint(outMint) : 'SOL',
      outAmount,
      usdValue: 0,
      // legacy fields — point to the "interesting" token (non-SOL side)
      tokenMint: (inMint ?? outMint) || '',
      tokenSymbol: inMint
        ? shortMint(inMint)
        : outMint
          ? shortMint(outMint)
          : 'SOL',
      tokenName: '',
      tokenAmount: inMint ? inAmount : outAmount,
      solAmount: Math.abs(solChange),
    };
  }

  private sendInsiderClusterAlert(
    chatId: number,
    ctx: {
      mint: string;
      symbol: string;
      name: string;
      marketCap: number;
      currentWallet: string;
      currentUsd: number;
      currentLabel: string;
      priorBuys: {
        address: string;
        label: string;
        totalUsd: number;
        solAmount: number;
        timestamp: Date;
      }[];
      signature: string;
    },
  ): void {
    const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
    const timeAgo = (d: Date): string => {
      const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
      return `${s}s ago`;
    };

    const walletLine = (
      addr: string,
      label: string,
      totalUsd: number,
      when: string,
    ): string => {
      const handle = label
        ? `<b>${label}</b>  ·  <code>${short(addr)}</code>`
        : `<code>${short(addr)}</code>`;
      const usd = totalUsd > 0 ? `  ·  ~$${totalUsd.toFixed(2)}` : '';
      return `   • ${handle}${usd}  ·  <i>${when}</i>`;
    };

    const priorLines = ctx.priorBuys
      .map((b) =>
        walletLine(b.address, b.label, b.totalUsd, timeAgo(b.timestamp)),
      )
      .join('\n');
    const currentLine = walletLine(
      ctx.currentWallet,
      ctx.currentLabel,
      ctx.currentUsd,
      'just now',
    );

    const mcFmt =
      ctx.marketCap > 0
        ? ctx.marketCap >= 1_000_000_000
          ? `$${(ctx.marketCap / 1_000_000_000).toFixed(2)}B`
          : ctx.marketCap >= 1_000_000
            ? `$${(ctx.marketCap / 1_000_000).toFixed(2)}M`
            : `$${(ctx.marketCap / 1_000).toFixed(1)}K`
        : '?';

    const count = ctx.priorBuys.length + 1;
    const tokenLabel = ctx.name
      ? `<b>${ctx.name}</b> ($${ctx.symbol})`
      : `$${ctx.symbol}`;

    const msg =
      `🚨 <b>INSIDER CLUSTER</b>  ·  ${count} wallets in ${SolanaService.INSIDER_WINDOW_SEC}s\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🪙 ${tokenLabel}\n` +
      `📊 MC: <b>${mcFmt}</b>\n` +
      `<code>${ctx.mint}</code>\n\n` +
      `${priorLines}\n${currentLine}`;

    this.bot.telegram
      .sendMessage(chatId, msg, {
        parse_mode: 'HTML',
        // @ts-ignore
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: this.buildTradeButtons(
            ctx.mint,
            ctx.signature,
            ctx.currentWallet,
          ),
        },
      })
      .catch((err) =>
        this.logger.error(`Insider alert to ${chatId} failed: ${err.message}`),
      );
  }

  private formatTransferMessage(
    walletAddress: string,
    signature: string,
    action: {
      outMint: string | null;
      outAmount: number;
      outSymbol: string;
      outName: string;
      solAmount: number;
      transferTo?: string;
    },
    label?: string,
  ): string {
    const walletShort = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
    const labelLine = label ? `🏷 <b>${label}</b>\n` : '';

    const assetLine = action.outMint
      ? `🪙 Token: <b>${action.outName || action.outSymbol}</b>\n` +
        `🟡 Amount: <b>${action.outAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>\n` +
        `📋 CA: <code>${action.outMint}</code>\n`
      : `◎ SOL: <b>${action.solAmount.toFixed(4)} SOL</b>\n`;

    const recipientLine = action.transferTo
      ? `📬 To: <code>${action.transferTo}</code>\n`
      : `📬 To: Unknown\n`;

    return (
      `📤 <b>TRANSFER</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      labelLine +
      `👛 ${walletShort}\n` +
      assetLine +
      recipientLine
    );
  }

  private formatTradeMessage(
    walletAddress: string,
    signature: string,
    action: {
      type: 'BUY' | 'SELL' | 'SWAP' | 'TRANSFER';
      inSymbol: string;
      inName: string;
      inMint: string | null;
      inAmount: number;
      outSymbol: string;
      outName: string;
      outMint: string | null;
      outAmount: number;
      usdValue: number;
      tokenMint: string;
      tokenSymbol: string;
      tokenName: string;
      tokenAmount: number;
      solAmount: number;
    },
    label?: string,
    extra?: {
      solPrice: number;
      marketPrice: number;
      marketCap: number;
      txFeeSol: number;
      txFeeUsd: number;
      txTime: string | null;
      priceImpact: number | null;
      isFirstBuy?: boolean;
      cluster?: { count: number; windowMinutes: number };
    },
  ): string {
    const labelLine = label ? `🏷 <b>${label}</b>\n` : '';
    const walletShort = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

    const fromName = action.outMint
      ? action.outName || action.outSymbol || 'Token'
      : 'SOL';
    const toName = action.inMint
      ? action.inName || action.inSymbol || 'Token'
      : 'SOL';

    const usdLine =
      action.usdValue > 0
        ? `💵 Value: <b>~$${action.usdValue.toFixed(2)}</b>\n`
        : '';

    const fromAmountFmt = action.outAmount.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
    const toAmountFmt = action.inAmount.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });

    const fromCaLine = action.outMint
      ? `🔴 <b>From CA:</b> <code>${action.outMint}</code>\n`
      : '';
    const toCaLine = action.inMint
      ? `🟢 <b>To CA:</b> <code>${action.inMint}</code>\n`
      : '';

    const mc = extra?.marketCap ?? 0;
    const mcFmt =
      mc > 0
        ? mc >= 1_000_000_000
          ? `MC $${(mc / 1_000_000_000).toFixed(2)}B`
          : mc >= 1_000_000
            ? `MC $${(mc / 1_000_000).toFixed(2)}M`
            : `MC $${(mc / 1_000).toFixed(2)}K`
        : '';

    // Header badge — BUY / SELL / SWAP
    const headerBadge =
      action.type === 'BUY'
        ? '🟢 <b>BUY</b>'
        : action.type === 'SELL'
          ? '🔴 <b>SELL</b>'
          : '🔄 <b>SWAP</b>';

    const firstBuyLine = extra?.isFirstBuy ? `🆕 <b>FIRST BUY</b>\n` : '';
    const clusterLine = extra?.cluster
      ? `🐋 <b>Cluster:</b> ${extra.cluster.count} of your watched wallets bought this in ${extra.cluster.windowMinutes}m\n`
      : '';

    return (
      firstBuyLine +
      clusterLine +
      labelLine +
      `${headerBadge}  🔴 <b><u>${fromName}</u></b> <b>${fromAmountFmt}</b>  TO  🟢 <b><u>${toName}</u></b> <b>${toAmountFmt}</b>${mcFmt ? `  📊 <b>${mcFmt}</b>` : ''}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👛 <b>Wallet:</b> <code>${walletShort}</code>\n` +
      usdLine +
      fromCaLine +
      toCaLine
    );
  }

  // ─── Backfill & PnL ──────────────────────────────────────────────────────────

  async backfillTrades(
    address: string,
    limit: number,
  ): Promise<{ success: boolean; message: string }> {
    try {
      new PublicKey(address);
    } catch {
      return { success: false, message: 'Invalid Solana address' };
    }

    try {
      const sigsRes = await this.connection.getSignaturesForAddress(
        new PublicKey(address),
        { limit },
      );

      if (!sigsRes.length) {
        return { success: false, message: 'No transactions found' };
      }

      // Use current SOL price as an approximation for historical USD values.
      // Not perfectly accurate for old trades but far better than 0, and lets
      // FIFO PnL / positions actually compute for backfilled data.
      const solPrice = (await this.getSolPrice()).price;

      let processed = 0;
      let errors = 0;
      let skippedTransfer = 0;

      for (const sig of sigsRes) {
        try {
          const tx = await this.connection.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });
          if (!tx || sig.err) continue;

          const action = this.detectAction(tx, address);
          if (!action) continue;
          if (action.type === 'TRANSFER') {
            skippedTransfer++;
            continue;
          }

          const totalUsd = action.solAmount * solPrice;
          const priceUsd =
            action.tokenAmount > 0 ? totalUsd / action.tokenAmount : 0;

          await this.prisma.trade.upsert({
            where: { signature: sig.signature },
            create: {
              walletAddress: address,
              type: action.type,
              tokenMint: action.tokenMint,
              tokenSymbol: action.tokenSymbol,
              tokenName: action.tokenName,
              tokenAmount: action.tokenAmount,
              priceUsd,
              totalUsd,
              solAmount: action.solAmount,
              signature: sig.signature,
              timestamp: sig.blockTime
                ? new Date(sig.blockTime * 1000)
                : new Date(),
            },
            update: {},
          });
          processed++;
        } catch {
          errors++;
        }
      }

      const note =
        solPrice > 0
          ? '\n<i>USD values estimated using current SOL price — historical prices not looked up.</i>'
          : '';
      return {
        success: true,
        message: `Backfilled ${processed} trades${errors > 0 ? ` (${errors} errors)` : ''}${skippedTransfer > 0 ? `\nSkipped ${skippedTransfer} non-trade transfers.` : ''}${note}`,
      };
    } catch (err) {
      return { success: false, message: `Error: ${err.message}` };
    }
  }

  /**
   * FIFO cost-basis PnL: walks all Trade records for a wallet in chronological
   * order and maintains a per-mint queue of buy lots. SELLs pop lots FIFO;
   * realized PnL = proceeds − popped cost. Any remaining lots at the end
   * represent the open cost basis for unrealized PnL.
   *
   * Trades with totalUsd = 0 (e.g. old backfilled rows before we started
   * pricing) are skipped so they don't corrupt the math.
   */
  private async computeFifoPnl(walletAddress: string): Promise<{
    perMint: Map<
      string,
      {
        mint: string;
        symbol: string;
        name: string;
        lots: Array<{ amount: number; costUsd: number }>;
        realizedUsd: number;
        totalBoughtUsd: number;
        totalSoldUsd: number;
        tokensBought: number;
        tokensSold: number;
        firstTradeAt: Date;
        lastTradeAt: Date;
        trades: number;
        closedPnls: number[];
      }
    >;
    totalRealized: number;
    totalBought: number;
    totalSold: number;
    tradeCount: number;
    priceableTradeCount: number;
  }> {
    const trades = await this.prisma.trade.findMany({
      where: { walletAddress },
      orderBy: { timestamp: 'asc' },
    });

    const perMint = new Map<
      string,
      {
        mint: string;
        symbol: string;
        name: string;
        lots: Array<{ amount: number; costUsd: number }>;
        realizedUsd: number;
        totalBoughtUsd: number;
        totalSoldUsd: number;
        tokensBought: number;
        tokensSold: number;
        firstTradeAt: Date;
        lastTradeAt: Date;
        trades: number;
        closedPnls: number[];
      }
    >();

    let totalBought = 0;
    let totalSold = 0;
    let totalRealized = 0;
    let priceableTradeCount = 0;

    for (const t of trades) {
      if (t.totalUsd <= 0 || t.tokenAmount <= 0) continue;
      priceableTradeCount++;

      let entry = perMint.get(t.tokenMint);
      if (!entry) {
        entry = {
          mint: t.tokenMint,
          symbol: t.tokenSymbol,
          name: t.tokenName,
          lots: [],
          realizedUsd: 0,
          totalBoughtUsd: 0,
          totalSoldUsd: 0,
          tokensBought: 0,
          tokensSold: 0,
          firstTradeAt: t.timestamp,
          lastTradeAt: t.timestamp,
          trades: 0,
          closedPnls: [],
        };
        perMint.set(t.tokenMint, entry);
      }
      // Backfill symbol/name if a later record has better metadata.
      if (t.tokenSymbol && !entry.symbol) entry.symbol = t.tokenSymbol;
      if (t.tokenName && !entry.name) entry.name = t.tokenName;
      entry.lastTradeAt = t.timestamp;
      entry.trades++;

      // Treat token-to-token SWAPs as a BUY of the received token — we don't
      // have both sides of the swap in a single Trade row so we can't handle
      // the sold-token side cleanly. Acceptable for typical degen flow which
      // is overwhelmingly SOL↔token.
      if (t.type === 'BUY' || t.type === 'SWAP') {
        entry.lots.push({ amount: t.tokenAmount, costUsd: t.totalUsd });
        entry.totalBoughtUsd += t.totalUsd;
        entry.tokensBought += t.tokenAmount;
        totalBought += t.totalUsd;
      } else if (t.type === 'SELL') {
        let remaining = t.tokenAmount;
        let costOfSold = 0;
        while (remaining > 0 && entry.lots.length > 0) {
          const lot = entry.lots[0];
          if (lot.amount <= remaining + 1e-9) {
            costOfSold += lot.costUsd;
            remaining -= lot.amount;
            entry.lots.shift();
          } else {
            const fraction = remaining / lot.amount;
            const takenCost = lot.costUsd * fraction;
            costOfSold += takenCost;
            lot.amount -= remaining;
            lot.costUsd -= takenCost;
            remaining = 0;
          }
        }
        const soldPortion = t.tokenAmount - remaining;
        const proceeds =
          t.tokenAmount > 0 ? (soldPortion / t.tokenAmount) * t.totalUsd : 0;
        const realized = proceeds - costOfSold;
        entry.realizedUsd += realized;
        entry.totalSoldUsd += proceeds;
        entry.tokensSold += soldPortion;
        entry.closedPnls.push(realized);
        totalSold += proceeds;
        totalRealized += realized;
      }
    }

    return {
      perMint,
      totalRealized,
      totalBought,
      totalSold,
      tradeCount: trades.length,
      priceableTradeCount,
    };
  }

  /**
   * Resolve a token symbol (e.g. "PUMP", "$BONK") to its most-liquid Solana
   * mint via DexScreener search. Case-insensitive. Returns null if nothing
   * matches. When multiple tokens share a symbol we pick the pair with the
   * highest liquidity.
   */
  async resolveSymbol(input: string): Promise<{
    mint: string;
    symbol: string;
    name: string;
    liquidityUsd: number;
    ambiguous: boolean; // true when other Solana pairs share this symbol
  } | null> {
    const q = input.trim().replace(/^\$/, '');
    if (!/^[A-Za-z0-9]{2,15}$/.test(q)) return null;
    try {
      const r = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
      );
      const d = await r.json();
      const pairs: any[] = d?.pairs ?? [];
      const solPairs = pairs.filter(
        (p) =>
          p?.chainId === 'solana' &&
          typeof p?.baseToken?.symbol === 'string' &&
          p.baseToken.symbol.toLowerCase() === q.toLowerCase(),
      );
      if (solPairs.length === 0) return null;
      solPairs.sort(
        (a, b) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0),
      );
      const top = solPairs[0];
      // Distinct mints matching the symbol — signals ambiguity.
      const distinctMints = new Set(
        solPairs.map((p) => p.baseToken?.address).filter(Boolean),
      );
      return {
        mint: top.baseToken.address,
        symbol: top.baseToken.symbol,
        name: top.baseToken.name ?? '',
        liquidityUsd: top?.liquidity?.usd ?? 0,
        ambiguous: distinctMints.size > 1,
      };
    } catch {
      return null;
    }
  }

  /**
   * Batched current price lookup via Jupiter Lite Price API v3. Returns a map
   * of mint → USD price. Silently drops mints without a price.
   */
  async getCurrentPrices(mints: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (mints.length === 0) return out;
    const unique = Array.from(new Set(mints));
    const CHUNK = 50;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      try {
        const r = await fetch(
          `https://lite-api.jup.ag/price/v3?ids=${slice.join(',')}`,
        );
        const d = await r.json();
        for (const [mint, entry] of Object.entries<any>(d ?? {})) {
          const p = entry?.usdPrice ?? entry?.price;
          if (typeof p === 'number' && p > 0) out.set(mint, p);
        }
      } catch {
        /* best effort */
      }
    }
    return out;
  }

  async getPnlAnalysis(address: string): Promise<string> {
    try {
      new PublicKey(address);
    } catch {
      throw new Error('invalid_address');
    }

    const { perMint, totalRealized, totalBought, totalSold, tradeCount } =
      await this.computeFifoPnl(address);

    if (tradeCount === 0)
      return '📭 No trades found. Run /backfill first, or wait for new trades to be recorded.';
    if (perMint.size === 0)
      return '📭 No priced trades yet. Live trades from now on are priced automatically; run /backfill for historical trades.';

    // Fetch current prices for mints that still have open lots (unrealized PnL)
    const openMints = Array.from(perMint.values())
      .filter((e) => e.lots.length > 0)
      .map((e) => e.mint);
    const currentPrices = await this.getCurrentPrices(openMints);

    // Compute per-token summary
    type TokenPnl = {
      symbol: string;
      mint: string;
      realized: number;
      unrealized: number;
      total: number;
      totalBoughtUsd: number;
      returnPct: number;
      remaining: number;
      wins: number;
      losses: number;
    };
    const tokenPnls: TokenPnl[] = [];
    let totalUnrealized = 0;
    let totalWins = 0;
    let totalLosses = 0;

    for (const e of perMint.values()) {
      const remaining = e.lots.reduce((s, l) => s + l.amount, 0);
      const remainingCost = e.lots.reduce((s, l) => s + l.costUsd, 0);
      const currentPrice = currentPrices.get(e.mint) ?? 0;
      const currentValue = remaining * currentPrice;
      const unrealized =
        currentPrice > 0 && remaining > 0 ? currentValue - remainingCost : 0;
      const total = e.realizedUsd + unrealized;
      const wins = e.closedPnls.filter((p) => p > 0).length;
      const losses = e.closedPnls.filter((p) => p < 0).length;
      totalUnrealized += unrealized;
      totalWins += wins;
      totalLosses += losses;
      tokenPnls.push({
        symbol: e.symbol || `${e.mint.slice(0, 4)}...${e.mint.slice(-4)}`,
        mint: e.mint,
        realized: e.realizedUsd,
        unrealized,
        total,
        totalBoughtUsd: e.totalBoughtUsd,
        returnPct: e.totalBoughtUsd > 0 ? (total / e.totalBoughtUsd) * 100 : 0,
        remaining,
        wins,
        losses,
      });
    }

    const totalPnl = totalRealized + totalUnrealized;
    const totalReturnPct = totalBought > 0 ? (totalPnl / totalBought) * 100 : 0;
    const winRate =
      totalWins + totalLosses > 0
        ? (totalWins / (totalWins + totalLosses)) * 100
        : 0;

    tokenPnls.sort((a, b) => b.total - a.total);
    const winners = tokenPnls.filter((t) => t.total > 0).slice(0, 5);
    const losers = tokenPnls
      .filter((t) => t.total < 0)
      .sort((a, b) => a.total - b.total)
      .slice(0, 5);

    const sign = (n: number) => (n >= 0 ? '+' : '');
    const emoji = (n: number) => (n >= 0 ? '🟢' : '🔴');
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;

    const line = (t: TokenPnl) => {
      const openTag = t.remaining > 0 ? ' 🟡 open' : '';
      const symLink = `<a href="https://dexscreener.com/solana/${t.mint}">$${t.symbol}</a>`;
      return (
        `  ${symLink}  ${emoji(t.total)} <b>${sign(t.total)}$${t.total.toFixed(2)}</b>` +
        `  (${sign(t.returnPct)}${t.returnPct.toFixed(1)}%)${openTag}`
      );
    };

    const lines: string[] = [
      `┌─────────────────────────────`,
      `│ 📊 <b>PnL ANALYSIS</b>`,
      `│ 👛 <a href="https://solscan.io/account/${address}">${short}</a>`,
      `└─────────────────────────────`,
      ``,
      `${emoji(totalPnl)} <b>Total PnL: ${sign(totalPnl)}$${totalPnl.toFixed(2)}</b> (${sign(totalReturnPct)}${totalReturnPct.toFixed(1)}%)`,
      `├ Realized:   <b>${sign(totalRealized)}$${totalRealized.toFixed(2)}</b>`,
      `├ Unrealized: <b>${sign(totalUnrealized)}$${totalUnrealized.toFixed(2)}</b>`,
      `├ Bought:     <b>$${totalBought.toFixed(2)}</b>`,
      `├ Sold:       <b>$${totalSold.toFixed(2)}</b>`,
      `└ Win rate:   <b>${winRate.toFixed(0)}%</b>  (${totalWins}W · ${totalLosses}L · ${perMint.size} tokens)`,
      ``,
    ];

    if (winners.length > 0) {
      lines.push(`🏆 <b>Top winners</b>`);
      winners.forEach((t) => lines.push(line(t)));
      lines.push(``);
    }
    if (losers.length > 0) {
      lines.push(`💀 <b>Top losers</b>`);
      losers.forEach((t) => lines.push(line(t)));
      lines.push(``);
    }

    lines.push(
      `<i>FIFO cost basis · uses trades in DB (${tradeCount} total). Run /backfill if numbers look off.</i>`,
    );

    return lines.join('\n');
  }

  /**
   * Ranks a user's watched wallets by all-time realized + unrealized PnL.
   * Reuses computeFifoPnl per wallet and prices open lots via a single
   * batched Jupiter call. Skips wallets with no priced trades.
   */
  async getWalletLeaderboard(chatId: number): Promise<
    {
      address: string;
      label: string;
      totalPnl: number;
      totalPnlPct: number;
      realized: number;
      unrealized: number;
      totalBought: number;
      tokenCount: number;
      trades: number;
      wins: number;
      losses: number;
      winRate: number;
      lastTradeAt: Date | null;
    }[]
  > {
    const watched = await this.prisma.watchedWallet.findMany({
      where: { userId: chatId },
      select: { walletAddress: true, label: true },
    });
    if (watched.length === 0) return [];

    // Compute FIFO per wallet first (cheap in memory; DB is the hot path).
    const fifoResults = await Promise.all(
      watched.map(async (w) => ({
        address: w.walletAddress,
        label: w.label ?? '',
        ...(await this.computeFifoPnl(w.walletAddress)),
      })),
    );

    // Collect every open mint across all wallets and price once.
    const openMints = new Set<string>();
    for (const r of fifoResults) {
      for (const e of r.perMint.values()) {
        if (e.lots.length > 0) openMints.add(e.mint);
      }
    }
    const prices = await this.getCurrentPrices(Array.from(openMints));

    const rows = fifoResults
      .map((r) => {
        let realized = 0;
        let unrealized = 0;
        let totalBought = 0;
        let wins = 0;
        let losses = 0;
        let trades = 0;
        let lastTradeAt: Date | null = null;
        let tokenCount = 0;

        for (const e of r.perMint.values()) {
          realized += e.realizedUsd;
          totalBought += e.totalBoughtUsd;
          trades += e.trades;
          tokenCount++;
          if (!lastTradeAt || e.lastTradeAt > lastTradeAt)
            lastTradeAt = e.lastTradeAt;
          for (const p of e.closedPnls) {
            if (p > 0) wins++;
            else if (p < 0) losses++;
          }
          if (e.lots.length > 0) {
            const remaining = e.lots.reduce((s, l) => s + l.amount, 0);
            const remainingCost = e.lots.reduce((s, l) => s + l.costUsd, 0);
            const currentPrice = prices.get(e.mint) ?? 0;
            if (currentPrice > 0)
              unrealized += remaining * currentPrice - remainingCost;
          }
        }

        const totalPnl = realized + unrealized;
        const totalPnlPct =
          totalBought > 0 ? (totalPnl / totalBought) * 100 : 0;
        const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;

        return {
          address: r.address,
          label: r.label,
          totalPnl,
          totalPnlPct,
          realized,
          unrealized,
          totalBought,
          tokenCount,
          trades,
          wins,
          losses,
          winRate,
          lastTradeAt,
        };
      })
      // Drop wallets we can't score yet — hide the noise floor.
      .filter((r) => r.totalBought > 0)
      .sort((a, b) => b.totalPnl - a.totalPnl);

    return rows;
  }

  /**
   * Returns recent BUYs by a chat's tracked wallets for a specific mint.
   * Used to power the "tracked wallets buying this" section on token cards.
   * Groups by wallet — returns each wallet's most-recent buy + running total.
   */
  async getRecentTrackedBuysForMint(
    chatId: number,
    mint: string,
    hours: number,
  ): Promise<
    {
      walletAddress: string;
      label: string;
      lastBuyAt: Date;
      buys: number;
      totalUsd: number;
    }[]
  > {
    const watched = await this.prisma.watchedWallet.findMany({
      where: { userId: chatId },
      select: { walletAddress: true, label: true },
    });
    if (watched.length === 0) return [];

    const addrs = watched.map((w) => w.walletAddress);
    const labels = new Map(
      watched.map((w) => [w.walletAddress, w.label ?? '']),
    );

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const trades = await this.prisma.trade.findMany({
      where: {
        walletAddress: { in: addrs },
        tokenMint: mint,
        type: 'BUY',
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'desc' },
      select: {
        walletAddress: true,
        timestamp: true,
        totalUsd: true,
      },
    });
    if (trades.length === 0) return [];

    const perWallet = new Map<
      string,
      { lastBuyAt: Date; buys: number; totalUsd: number }
    >();
    for (const t of trades) {
      const cur = perWallet.get(t.walletAddress);
      if (cur) {
        cur.buys++;
        cur.totalUsd += t.totalUsd;
        if (t.timestamp > cur.lastBuyAt) cur.lastBuyAt = t.timestamp;
      } else {
        perWallet.set(t.walletAddress, {
          lastBuyAt: t.timestamp,
          buys: 1,
          totalUsd: t.totalUsd,
        });
      }
    }

    return Array.from(perWallet.entries())
      .map(([addr, v]) => ({
        walletAddress: addr,
        label: labels.get(addr) ?? '',
        ...v,
      }))
      .sort((a, b) => b.lastBuyAt.getTime() - a.lastBuyAt.getTime());
  }

  /**
   * Currently held positions per Trade table + on-chain balance check.
   * Cross-references FIFO remaining tokens against Helius DAS balance and
   * flags mismatch (e.g. tokens received via transfer or sent out).
   */
  async getOpenPositions(address: string): Promise<string> {
    try {
      new PublicKey(address);
    } catch {
      throw new Error('invalid_address');
    }

    const { perMint } = await this.computeFifoPnl(address);

    // Compute FIFO remaining per mint
    type Row = {
      mint: string;
      symbol: string;
      remaining: number; // FIFO remaining
      onChain: number; // Helius balance
      costUsd: number; // FIFO remaining cost
      currentPrice: number;
      currentValue: number;
      unrealized: number;
    };
    const mintsWithLots: Row[] = [];
    for (const e of perMint.values()) {
      const remaining = e.lots.reduce((s, l) => s + l.amount, 0);
      const costUsd = e.lots.reduce((s, l) => s + l.costUsd, 0);
      if (remaining <= 0) continue;
      mintsWithLots.push({
        mint: e.mint,
        symbol: e.symbol || `${e.mint.slice(0, 4)}...${e.mint.slice(-4)}`,
        remaining,
        onChain: 0,
        costUsd,
        currentPrice: 0,
        currentValue: 0,
        unrealized: 0,
      });
    }

    if (mintsWithLots.length === 0)
      return '📭 No open positions tracked. Run /backfill or wait for new BUY alerts.';

    // Fetch current prices + on-chain balances in parallel.
    const [prices, onChainBalances] = await Promise.all([
      this.getCurrentPrices(mintsWithLots.map((r) => r.mint)),
      this.getOnChainTokenBalances(address),
    ]);

    let totalCost = 0;
    let totalValue = 0;
    for (const r of mintsWithLots) {
      r.currentPrice = prices.get(r.mint) ?? 0;
      r.onChain = onChainBalances.get(r.mint) ?? 0;
      r.currentValue = r.remaining * r.currentPrice;
      r.unrealized = r.currentValue - r.costUsd;
      totalCost += r.costUsd;
      totalValue += r.currentValue;
    }

    mintsWithLots.sort((a, b) => b.currentValue - a.currentValue);

    const totalUnrealized = totalValue - totalCost;
    const totalReturnPct =
      totalCost > 0 ? (totalUnrealized / totalCost) * 100 : 0;
    const sign = (n: number) => (n >= 0 ? '+' : '');
    const emoji = (n: number) => (n >= 0 ? '🟢' : '🔴');
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;

    const lines: string[] = [
      `┌─────────────────────────────`,
      `│ 📈 <b>OPEN POSITIONS</b>`,
      `│ 👛 <a href="https://solscan.io/account/${short}">${short}</a>`,
      `└─────────────────────────────`,
      ``,
      `${emoji(totalUnrealized)} <b>Unrealized: ${sign(totalUnrealized)}$${totalUnrealized.toFixed(2)}</b> (${sign(totalReturnPct)}${totalReturnPct.toFixed(1)}%)`,
      `├ Cost basis:  <b>$${totalCost.toFixed(2)}</b>`,
      `├ Current:     <b>$${totalValue.toFixed(2)}</b>`,
      `└ Positions:   <b>${mintsWithLots.length}</b>`,
      ``,
    ];

    for (const r of mintsWithLots) {
      const symLink = `<a href="https://dexscreener.com/solana/${r.mint}">$${r.symbol}</a>`;
      const balanceLine =
        r.onChain > 0 && Math.abs(r.onChain - r.remaining) / r.remaining > 0.1
          ? `\n     ⚠️ On-chain: ${r.onChain.toLocaleString(undefined, { maximumFractionDigits: 2 })}  (transferred in/out)`
          : '';
      const priceLine =
        r.currentPrice > 0
          ? `${r.currentPrice < 0.0001 ? r.currentPrice.toExponential(2) : `$${r.currentPrice.toFixed(6)}`}`
          : 'no price';
      lines.push(
        `🪙 ${symLink}  ${emoji(r.unrealized)} <b>${sign(r.unrealized)}$${r.unrealized.toFixed(2)}</b>`,
        `   💰 ${r.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })}  ·  📊 ${priceLine}`,
        `   💵 Cost: $${r.costUsd.toFixed(2)}  ·  Value: <b>$${r.currentValue.toFixed(2)}</b>${balanceLine}`,
        '',
      );
    }

    return lines.join('\n');
  }

  /**
   * Fetch token balances from Helius DAS. Returns map of mint → uiAmount.
   */
  private async getOnChainTokenBalances(
    address: string,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    try {
      const res = await fetch(
        `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getAssetsByOwner',
            params: {
              ownerAddress: address,
              page: 1,
              limit: 200,
              displayOptions: { showFungible: true, showNativeBalance: false },
            },
          }),
        },
      );
      const data = await res.json();
      const items: any[] = data?.result?.items || [];
      for (const item of items) {
        if (
          item.interface !== 'FungibleToken' &&
          item.interface !== 'FungibleAsset'
        )
          continue;
        const info = item.token_info;
        const balance = info?.balance ?? 0;
        const decimals = info?.decimals ?? 0;
        const uiAmount = balance / Math.pow(10, decimals);
        if (uiAmount > 0) out.set(item.id, uiAmount);
      }
    } catch {
      /* best effort */
    }
    return out;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private bar(value: number, total: number): string {
    if (total === 0) return '';
    const pct = value / total;
    const filled = Math.round(pct * 8);
    return (
      '▓'.repeat(filled) +
      '░'.repeat(8 - filled) +
      ` ${(pct * 100).toFixed(1)}%`
    );
  }
}
