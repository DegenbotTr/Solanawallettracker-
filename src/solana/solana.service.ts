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
  }

  onModuleDestroy() {
    this.watchedWallets.forEach(({ subId }) => {
      this.connection.removeOnLogsListener(subId).catch(() => {});
    });
  }

  // ─── Wallet Watch ────────────────────────────────────────────────────────────

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
        where: { userId_walletAddress: { userId: chatId, walletAddress: address } },
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
        where: { userId_walletAddress: { userId: chatId, walletAddress: address } },
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

  async getWatchedWallets(chatId: number): Promise<{ address: string; label: string }[]> {
    const list = await this.prisma.watchedWallet.findMany({
      where: { userId: chatId },
      select: { walletAddress: true, label: true },
    });
    return list.map((item) => ({
      address: item.walletAddress,
      label: item.label ?? '',
    }));
  }

  async setWalletLabel(chatId: number, address: string, label: string): Promise<boolean> {
    try {
      await this.prisma.watchedWallet.update({
        where: { userId_walletAddress: { userId: chatId, walletAddress: address } },
        data: { label },
      });
      return true;
    } catch {
      return false;
    }
  }

  async getWalletLabel(chatId: number, address: string): Promise<string> {
    const entry = await this.prisma.watchedWallet.findUnique({
      where: { userId_walletAddress: { userId: chatId, walletAddress: address } },
      select: { label: true },
    });
    return entry?.label ?? '';
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
      `This bot only supports <b>Solana</b> wallets.\n` +
      `Solana addresses look like:\n<code>EizqmoCSovbTzuSnmxkdaJwLBBZgyB2GyjN3m3uJWXpZ</code>`
    );
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

    let solPrice = 0,
      solChange24h = 0;
    try {
      const p = await (
        await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true',
        )
      ).json();
      solPrice = p?.solana?.usd ?? 0;
      solChange24h = p?.solana?.usd_24h_change ?? 0;
    } catch {
      this.logger.warn('Could not fetch SOL price');
    }

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

    // Fetch SOL price once for USD conversion
    let solPrice = 0;
    try {
      const p = await (
        await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
        )
      ).json();
      solPrice = p?.solana?.usd ?? 0;
    } catch {
      /* best effort */
    }

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

      // Fetch current SOL price to calculate USD value of the trade
      let solPrice = 0;
      try {
        const p = await (
          await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
          )
        ).json();
        solPrice = p?.solana?.usd ?? 0;
      } catch {
        /* best effort */
      }

      action.usdValue = action.solAmount * solPrice;

      // Fetch all users watching this wallet from DB
      const watchers = await this.prisma.watchedWallet.findMany({
        where: { walletAddress },
        include: { user: true },
      });

      for (const watcher of watchers) {
        const chatId = Number(watcher.userId);
        const min = watcher.user.minTradeSize;
        if (action.usdValue < min) continue;

        const label = watcher.label ?? '';
        const message = this.formatTradeMessage(
          walletAddress,
          signature,
          action,
          label,
        );

        this.bot.telegram
          .sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '💼 Portfolio',
                    callback_data: `wallet_portfolio:${walletAddress}`,
                  },
                  {
                    text: '📜 TX History',
                    callback_data: `wallet_txhistory:${walletAddress}`,
                  },
                ],
                ...(action.tokenMint
                   ? [
                      [
                        {
                          text: '📈 Chart',
                          url: `https://dexscreener.com/solana/${action.tokenMint}`,
                        },
                        {
                          text: '🪙 Token',
                          url: `https://solscan.io/token/${action.tokenMint}`,
                        },
                      ],
                    ]
                  : []),
                [
                  {
                    text: '👛 Wallet',
                    url: `https://solscan.io/account/${walletAddress}`,
                  },
                ],
              ],
            },
          })
          .catch((err) => {
            this.logger.error(`Failed to send to ${chatId}: ${err.message}`);
          });
      }
    } catch (err) {
      this.logger.error(`Error handling tx ${signature}: ${err.message}`);
    }
  }

  private detectAction(
    tx: ParsedTransactionWithMeta,
    walletAddress: string,
  ): {
    type: 'BUY' | 'SELL';
    tokenSymbol: string;
    tokenMint: string;
    tokenAmount: number;
    solAmount: number;
    usdValue: number;
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

    // Must have a meaningful SOL change
    const type = solChange < -0.001 ? 'BUY' : solChange > 0.001 ? 'SELL' : null;
    if (!type) return null;

    const preTokenBalances = tx.meta?.preTokenBalances || [];
    const postTokenBalances = tx.meta?.postTokenBalances || [];

    // Find any token that changed for this wallet
    const changedToken = postTokenBalances.find(
      (post) =>
        post.owner === walletAddress &&
        preTokenBalances.some(
          (pre) =>
            pre.mint === post.mint &&
            pre.uiTokenAmount.uiAmount !== post.uiTokenAmount.uiAmount,
        ),
    );

    // Also check for new token (first buy — no pre balance entry)
    const newToken =
      !changedToken &&
      postTokenBalances.find(
        (post) =>
          post.owner === walletAddress &&
          !preTokenBalances.some(
            (pre) => pre.mint === post.mint && pre.owner === walletAddress,
          ),
      );

    const token = changedToken || newToken;

    // If no token changed, this is a plain SOL transfer — skip it
    if (!token) return null;

    let tokenMint = token.mint;
    let tokenSymbol = `${token.mint.slice(0, 6)}...${token.mint.slice(-4)}`;
    let tokenAmount = 0;

    if (changedToken) {
      const pre = preTokenBalances.find(
        (p) => p.mint === changedToken.mint && p.owner === walletAddress,
      );
      tokenAmount = Math.abs(
        (changedToken.uiTokenAmount.uiAmount ?? 0) -
          (pre?.uiTokenAmount.uiAmount ?? 0),
      );
    } else if (newToken) {
      tokenAmount = newToken.uiTokenAmount.uiAmount ?? 0;
    }

    return {
      type,
      tokenSymbol,
      tokenMint,
      tokenAmount,
      solAmount: Math.abs(solChange),
      usdValue: 0,
    };
  }

  private formatTradeMessage(
    walletAddress: string,
    signature: string,
    action: {
      type: 'BUY' | 'SELL';
      tokenSymbol: string;
      tokenMint: string;
      tokenAmount: number;
      solAmount: number;
      usdValue: number;
    },
    label?: string,
  ): string {
    const isBuy = action.type === 'BUY';
    const emoji = isBuy ? '🟢' : '🔴';
    const labelLine = label ? `🏷 <b>${label}</b>\n` : '';
    const short = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

    const usdLine =
      action.usdValue > 0
        ? `💵 Value: <b>~$${action.usdValue.toFixed(2)}</b>\n`
        : '';

    const tokenAmountLine =
      action.tokenAmount > 0
        ? `🪙 Tokens: <b>${action.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>\n`
        : '';

    const pricePerToken =
      action.tokenAmount > 0 && action.usdValue > 0
        ? `📊 Price paid: <b>$${(action.usdValue / action.tokenAmount).toExponential(4)}</b> per token\n`
        : '';

    const links = action.tokenMint
      ? `🔗 <a href="https://dexscreener.com/solana/${action.tokenMint}">Chart</a>  ·  <a href="https://solscan.io/token/${action.tokenMint}">Token</a>  ·  <a href="https://solscan.io/tx/${signature}">TX</a>`
      : `🔗 <a href="https://solscan.io/tx/${signature}">View Transaction</a>`;

    return (
      `${emoji} <b>${isBuy ? '🟢 BUY' : '🔴 SELL'}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      labelLine +
      `👛 <a href="https://solscan.io/account/${walletAddress}">${short}</a>\n` +
      `🏷 Token: <b>${action.tokenSymbol}</b>\n` +
      tokenAmountLine +
      `◎ SOL: <b>${action.solAmount.toFixed(4)} SOL</b>\n` +
      usdLine +
      pricePerToken +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      links
    );
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
