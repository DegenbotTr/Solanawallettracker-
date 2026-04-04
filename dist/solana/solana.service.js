"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var SolanaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolanaService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const web3_js_1 = require("@solana/web3.js");
const nestjs_telegraf_1 = require("nestjs-telegraf");
const telegraf_1 = require("telegraf");
const prisma_service_1 = require("../prisma/prisma.service");
const startTime = new Date();
let SolanaService = SolanaService_1 = class SolanaService {
    constructor(config, prisma, bot) {
        this.config = config;
        this.prisma = prisma;
        this.bot = bot;
        this.logger = new common_1.Logger(SolanaService_1.name);
        this.watchedWallets = new Map();
    }
    async onModuleInit() {
        this.apiKey = this.config.get('HELIUS_API_KEY');
        const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
        const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
        this.connection = new web3_js_1.Connection(rpcUrl, {
            wsEndpoint: wsUrl,
            commitment: 'confirmed',
        });
        const allWatched = await this.prisma.wallet.findMany({
            include: { watchers: true },
        });
        for (const w of allWatched) {
            if (w.watchers.length > 0) {
                await this.initWalletSubscription(w.address);
            }
        }
        const envWallets = this.config.get('WATCHED_WALLETS', '');
        if (envWallets) {
            for (const addr of envWallets.split(',')) {
                const trimmed = addr.trim();
                if (trimmed)
                    await this.watchWallet(trimmed, null);
            }
        }
    }
    onModuleDestroy() {
        this.watchedWallets.forEach(({ subId }) => {
            this.connection.removeOnLogsListener(subId).catch(() => { });
        });
    }
    async initWalletSubscription(address) {
        if (this.watchedWallets.has(address)) {
            return this.watchedWallets.get(address).subId;
        }
        const subId = this.connection.onLogs(new web3_js_1.PublicKey(address), async (logs) => {
            if (logs.err)
                return;
            await this.handleTransaction(address, logs.signature);
        }, 'confirmed');
        this.watchedWallets.set(address, { subId, chatIds: new Set() });
        this.logger.log(`Subscription active for: ${address}`);
        return subId;
    }
    async validateWallet(address) {
        try {
            new web3_js_1.PublicKey(address);
        }
        catch {
            return 'invalid_address';
        }
        try {
            const accountInfo = await this.connection.getAccountInfo(new web3_js_1.PublicKey(address));
            if (!accountInfo)
                return 'valid';
            const SYSTEM_PROGRAM = '11111111111111111111111111111111';
            if (accountInfo.owner.toBase58() === SYSTEM_PROGRAM)
                return 'valid';
            return 'not_wallet';
        }
        catch {
            return 'valid';
        }
    }
    async watchWallet(address, chatId) {
        try {
            new web3_js_1.PublicKey(address);
        }
        catch {
            return false;
        }
        await this.prisma.wallet.upsert({
            where: { address },
            create: { address },
            update: {},
        });
        if (chatId) {
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
        await this.initWalletSubscription(address);
        return true;
    }
    async unwatchWallet(address, chatId) {
        try {
            await this.prisma.watchedWallet.delete({
                where: {
                    userId_walletAddress: { userId: chatId, walletAddress: address },
                },
            });
            const otherWatchers = await this.prisma.watchedWallet.count({
                where: { walletAddress: address },
            });
            if (otherWatchers === 0) {
                const entry = this.watchedWallets.get(address);
                if (entry) {
                    this.connection.removeOnLogsListener(entry.subId).catch(() => { });
                    this.watchedWallets.delete(address);
                }
            }
            return true;
        }
        catch (e) {
            return false;
        }
    }
    async getWatchedWallets(chatId) {
        const list = await this.prisma.watchedWallet.findMany({
            where: { userId: chatId },
            select: { walletAddress: true, label: true },
        });
        return list.map((item) => ({
            address: item.walletAddress,
            label: item.label ?? '',
        }));
    }
    async setWalletLabel(chatId, address, label) {
        try {
            await this.prisma.watchedWallet.update({
                where: {
                    userId_walletAddress: { userId: chatId, walletAddress: address },
                },
                data: { label },
            });
            return true;
        }
        catch {
            return false;
        }
    }
    async getWalletLabel(chatId, address) {
        const entry = await this.prisma.watchedWallet.findUnique({
            where: {
                userId_walletAddress: { userId: chatId, walletAddress: address },
            },
            select: { label: true },
        });
        return entry?.label ?? '';
    }
    async addWalletTag(chatId, address, tag) {
        try {
            const entry = await this.prisma.watchedWallet.findUnique({
                where: {
                    userId_walletAddress: { userId: chatId, walletAddress: address },
                },
                select: { tags: true },
            });
            if (!entry)
                return false;
            const normalizedTag = tag.toLowerCase().trim();
            if (entry.tags.includes(normalizedTag))
                return true;
            const newTags = [...entry.tags, normalizedTag];
            await this.prisma.watchedWallet.update({
                where: {
                    userId_walletAddress: { userId: chatId, walletAddress: address },
                },
                data: { tags: newTags },
            });
            return true;
        }
        catch {
            return false;
        }
    }
    async removeWalletTag(chatId, address, tag) {
        try {
            const entry = await this.prisma.watchedWallet.findUnique({
                where: {
                    userId_walletAddress: { userId: chatId, walletAddress: address },
                },
                select: { tags: true },
            });
            if (!entry)
                return false;
            const normalizedTag = tag.toLowerCase().trim();
            const newTags = entry.tags.filter((t) => t !== normalizedTag);
            await this.prisma.watchedWallet.update({
                where: {
                    userId_walletAddress: { userId: chatId, walletAddress: address },
                },
                data: { tags: newTags },
            });
            return true;
        }
        catch {
            return false;
        }
    }
    async getWalletTags(chatId, address) {
        const entry = await this.prisma.watchedWallet.findUnique({
            where: {
                userId_walletAddress: { userId: chatId, walletAddress: address },
            },
            select: { tags: true },
        });
        return entry?.tags ?? [];
    }
    async getWalletsByTag(chatId, tag) {
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
    async getAllTags(chatId) {
        const wallets = await this.prisma.watchedWallet.findMany({
            where: { userId: chatId },
            select: { tags: true },
        });
        const allTags = new Set();
        wallets.forEach((w) => w.tags.forEach((t) => allTags.add(t)));
        return Array.from(allTags).sort();
    }
    detectChain(address) {
        const trimmed = address.trim();
        if (/^0x[a-fA-F0-9]{40}$/.test(trimmed))
            return 'ethereum';
        if (/^(1|3)[a-zA-Z0-9]{25,34}$/.test(trimmed) ||
            /^bc1[a-zA-Z0-9]{6,87}$/.test(trimmed))
            return 'bitcoin';
        if (/^T[a-zA-Z0-9]{33}$/.test(trimmed))
            return 'tron';
        if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
            try {
                new web3_js_1.PublicKey(trimmed);
                return 'solana';
            }
            catch {
            }
        }
        return 'unknown';
    }
    chainErrorMessage(address) {
        const chain = this.detectChain(address);
        if (chain === 'solana')
            return null;
        const chainNames = {
            ethereum: '⟠ Ethereum / EVM (MetaMask address)',
            bitcoin: '₿ Bitcoin',
            tron: '🔺 Tron',
        };
        const detected = chainNames[chain] ?? '❓ Unknown chain';
        return (`⛔ <b>That's not a Solana wallet</b>\n\n` +
            `Detected: <b>${detected}</b>\n\n` +
            `This bot only supports <b>Solana</b> wallets.\n` +
            `Solana addresses look like:\n<code>EizqmoCSovbTzuSnmxkdaJwLBBZgyB2GyjN3m3uJWXpZ</code>`);
    }
    async setMinTradeSize(chatId, usd) {
        await this.prisma.user.upsert({
            where: { id: chatId },
            create: { id: chatId, minTradeSize: usd },
            update: { minTradeSize: usd },
        });
    }
    async getMinTradeSize(chatId) {
        const user = await this.prisma.user.findUnique({
            where: { id: chatId },
            select: { minTradeSize: true },
        });
        return user?.minTradeSize ?? 0;
    }
    async trackUser(chatId, username) {
        await this.prisma.user.upsert({
            where: { id: chatId },
            create: { id: chatId, username },
            update: { username, lastSeen: new Date() },
        });
    }
    async getStats() {
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
    async getPortfolio(address) {
        try {
            new web3_js_1.PublicKey(address);
        }
        catch {
            throw new Error('invalid_address');
        }
        const dasRes = await fetch(`https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`, {
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
        });
        const dasData = await dasRes.json();
        const items = dasData?.result?.items || [];
        const nativeBalance = dasData?.result?.nativeBalance;
        let solPrice = 0, solChange24h = 0;
        try {
            const p = await (await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true')).json();
            solPrice = p?.solana?.usd ?? 0;
            solChange24h = p?.solana?.usd_24h_change ?? 0;
        }
        catch {
            this.logger.warn('Could not fetch SOL price');
        }
        const solBalance = (nativeBalance?.lamports ?? 0) / 1e9;
        const solUsd = solBalance * solPrice;
        const tokens = items.filter((i) => (i.interface === 'FungibleToken' || i.interface === 'FungibleAsset') &&
            (i.token_info?.balance ?? 0) > 0);
        let totalUsd = solUsd;
        const tokenData = tokens.map((token) => {
            const info = token.token_info;
            const uiBalance = (info?.balance ?? 0) / Math.pow(10, info?.decimals ?? 0);
            const pricePerToken = info?.price_info?.price_per_token ?? 0;
            const usdValue = uiBalance * pricePerToken;
            totalUsd += usdValue;
            return {
                symbol: token.content?.metadata?.symbol || info?.symbol || '???',
                uiBalance,
                pricePerToken,
                usdValue,
                mint: token.id,
            };
        });
        if (tokens.length === 0 && solBalance === 0)
            return '📭 This wallet appears to be empty.';
        tokenData.sort((a, b) => b.usdValue - a.usdValue);
        const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
        const chg = solChange24h >= 0;
        const lines = [
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
            const pct = totalUsd > 0 ? ((t.usdValue / totalUsd) * 100).toFixed(1) : '0.0';
            const price = t.pricePerToken > 0
                ? `$${t.pricePerToken < 0.0001 ? t.pricePerToken.toExponential(2) : t.pricePerToken.toFixed(4)}`
                : 'no price';
            const value = t.usdValue > 0 ? `<b>$${t.usdValue.toFixed(2)}</b>` : '<i>unknown</i>';
            const mintShort = `${t.mint.slice(0, 4)}...${t.mint.slice(-4)}`;
            lines.push(`🪙 <b>${t.symbol}</b>  ${this.bar(t.usdValue, totalUsd)}`, `   💰 ${t.uiBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}  ·  ${value}`, `   📊 ${price} per token  ·  📐 ${pct}%`, `   � <a href="https://solscan.io/token/${t.mint}">${mintShort}</a>  ·  <a href="https://dexscreener.com/solana/${t.mint}">Chart</a>\n`);
        }
        lines.push(`� <a href="https://solscan.io/account/${address}">Full wallet on Solscan</a>`);
        return lines.join('\n');
    }
    async getTxHistory(address) {
        try {
            new web3_js_1.PublicKey(address);
        }
        catch {
            throw new Error('invalid_address');
        }
        const sigsRes = await this.connection.getSignaturesForAddress(new web3_js_1.PublicKey(address), { limit: 10 });
        if (!sigsRes.length)
            return '📭 No recent transactions found.';
        let solPrice = 0;
        try {
            const p = await (await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')).json();
            solPrice = p?.solana?.usd ?? 0;
        }
        catch {
        }
        const txs = await Promise.all(sigsRes.map((s) => this.connection
            .getParsedTransaction(s.signature, {
            maxSupportedTransactionVersion: 0,
        })
            .catch(() => null)));
        const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
        const lines = [
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
            let detailLines = [];
            if (tx && !sig.err) {
                const accountKeys = tx.transaction.message.accountKeys;
                const walletIndex = accountKeys.findIndex((k) => k.pubkey?.toString() === address || k.toString() === address);
                if (walletIndex !== -1) {
                    const solChange = ((tx.meta?.postBalances?.[walletIndex] ?? 0) -
                        (tx.meta?.preBalances?.[walletIndex] ?? 0)) /
                        1e9;
                    const pre = tx.meta?.preTokenBalances || [];
                    const post = tx.meta?.postTokenBalances || [];
                    const changed = post.find((p) => p.owner === address &&
                        pre.some((r) => r.mint === p.mint &&
                            r.uiTokenAmount.uiAmount !== p.uiTokenAmount.uiAmount)) ||
                        post.find((p) => p.owner === address &&
                            !pre.some((r) => r.mint === p.mint && r.owner === address));
                    const isBuy = solChange < -0.001;
                    const isSell = solChange > 0.001;
                    if ((isBuy || isSell) && changed) {
                        typeLabel = isBuy ? '🟢 BUY' : '🔴 SELL';
                        const solAmt = Math.abs(solChange);
                        const usdAmt = solAmt * solPrice;
                        const preEntry = pre.find((r) => r.mint === changed.mint && r.owner === address);
                        const tokenAmt = Math.abs((changed.uiTokenAmount.uiAmount ?? 0) -
                            (preEntry?.uiTokenAmount.uiAmount ?? 0));
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
                    }
                    else if (Math.abs(solChange) > 0.000001 && !changed) {
                        typeLabel = solChange > 0 ? '📥 Received' : '📤 Sent';
                        detailLines = [
                            `   ◎ ${Math.abs(solChange).toFixed(4)} SOL  ·  <b>~$${(Math.abs(solChange) * solPrice).toFixed(2)}</b>`,
                        ];
                    }
                }
            }
            lines.push(`<b>${i + 1}.</b> ${status} ${typeLabel}  ·  🕐 ${time}`);
            lines.push(...detailLines);
            lines.push(`   🔗 <a href="https://solscan.io/tx/${sig.signature}">${sigShort}</a>\n`);
        }
        return lines.join('\n');
    }
    async getTokenPrice(mintOrSymbol) {
        try {
            const res = await fetch(`https://price.jup.ag/v6/price?ids=${mintOrSymbol}`);
            const data = await res.json();
            const entry = data?.data?.[mintOrSymbol];
            if (entry) {
                const price = entry.price;
                const id = entry.id;
                const idShort = id.length > 20 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
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
        }
        catch {
        }
        return `❌ Could not find price for <code>${mintOrSymbol}</code>.\nTry using the full mint address.`;
    }
    async handleTransaction(walletAddress, signature) {
        try {
            const tx = await this.connection.getParsedTransaction(signature, {
                maxSupportedTransactionVersion: 0,
            });
            if (!tx)
                return;
            const action = this.detectAction(tx, walletAddress);
            if (!action)
                return;
            let solPrice = 0;
            try {
                const p = await (await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')).json();
                solPrice = p?.solana?.usd ?? 0;
            }
            catch {
            }
            action.usdValue = action.solAmount * solPrice;
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
            if (action.tokenMint === action.inMint) {
                action.tokenSymbol = action.inSymbol;
                action.tokenName = action.inName;
            }
            else if (action.tokenMint === action.outMint) {
                action.tokenSymbol = action.outSymbol;
                action.tokenName = action.outName;
            }
            const primaryMint = action.inMint ?? action.outMint;
            let marketPrice = 0;
            if (primaryMint) {
                try {
                    const jr = await fetch(`https://price.jup.ag/v6/price?ids=${primaryMint}`);
                    const jd = await jr.json();
                    marketPrice = jd?.data?.[primaryMint]?.price ?? 0;
                }
                catch {
                }
            }
            const txFeeSol = (tx.meta?.fee ?? 0) / 1e9;
            const txFeeUsd = txFeeSol * solPrice;
            const txTime = tx.blockTime
                ? new Date(tx.blockTime * 1000).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                })
                : null;
            let priceImpact = null;
            if (marketPrice > 0 &&
                action.inMint &&
                action.inAmount > 0 &&
                action.usdValue > 0) {
                const paidPerToken = action.usdValue / action.inAmount;
                priceImpact = ((paidPerToken - marketPrice) / marketPrice) * 100;
            }
            const entry = this.watchedWallets.get(walletAddress);
            if (!entry)
                return;
            const watchers = await this.prisma.watchedWallet.findMany({
                where: { walletAddress },
                include: { user: true },
            });
            for (const watcher of watchers) {
                const chatId = Number(watcher.userId);
                const min = watcher.user.minTradeSize;
                if (action.usdValue < min)
                    continue;
                const label = watcher.label ?? '';
                const message = this.formatTradeMessage(walletAddress, signature, action, label, { solPrice, marketPrice, txFeeSol, txFeeUsd, txTime, priceImpact });
                const primaryMintForButtons = action.inMint ?? action.outMint;
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
                            ...(primaryMintForButtons
                                ? [
                                    [
                                        {
                                            text: '📈 Chart',
                                            url: `https://dexscreener.com/solana/${primaryMintForButtons}`,
                                        },
                                        {
                                            text: '🐦 Birdeye',
                                            url: `https://birdeye.so/token/${primaryMintForButtons}?chain=solana`,
                                        },
                                    ],
                                ]
                                : []),
                            [
                                {
                                    text: '🔍 TX on Solscan',
                                    url: `https://solscan.io/tx/${signature}`,
                                },
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
        }
        catch (err) {
            this.logger.error(`Error handling tx ${signature}: ${err.message}`);
        }
    }
    async fetchTokenMeta(mint) {
        try {
            const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getAsset',
                    params: { id: mint },
                }),
            });
            const data = await res.json();
            const meta = data?.result?.content?.metadata;
            const info = data?.result?.token_info;
            return {
                name: meta?.name || info?.name || '',
                symbol: meta?.symbol || info?.symbol || '',
            };
        }
        catch {
            return { name: '', symbol: '' };
        }
    }
    detectAction(tx, walletAddress) {
        const accountKeys = tx.transaction.message.accountKeys;
        const walletIndex = accountKeys.findIndex((k) => k.pubkey?.toString() === walletAddress ||
            k.toString() === walletAddress);
        if (walletIndex === -1)
            return null;
        const solChange = ((tx.meta?.postBalances?.[walletIndex] ?? 0) -
            (tx.meta?.preBalances?.[walletIndex] ?? 0)) /
            1e9;
        const preTokenBalances = tx.meta?.preTokenBalances || [];
        const postTokenBalances = tx.meta?.postTokenBalances || [];
        const allMints = new Set([
            ...preTokenBalances
                .filter((b) => b.owner === walletAddress)
                .map((b) => b.mint),
            ...postTokenBalances
                .filter((b) => b.owner === walletAddress)
                .map((b) => b.mint),
        ]);
        const tokenDeltas = [];
        for (const mint of allMints) {
            const pre = preTokenBalances.find((b) => b.mint === mint && b.owner === walletAddress);
            const post = postTokenBalances.find((b) => b.mint === mint && b.owner === walletAddress);
            const delta = (post?.uiTokenAmount.uiAmount ?? 0) -
                (pre?.uiTokenAmount.uiAmount ?? 0);
            if (Math.abs(delta) > 0)
                tokenDeltas.push({ mint, delta });
        }
        const tokensIn = tokenDeltas.filter((t) => t.delta > 0);
        const tokensOut = tokenDeltas.filter((t) => t.delta < 0);
        const solIn = solChange > 0.001;
        const solOut = solChange < -0.001;
        if (!solIn && !solOut && tokenDeltas.length === 0)
            return null;
        if (tokenDeltas.length === 0)
            return null;
        let inMint = null;
        let inAmount = 0;
        let outMint = null;
        let outAmount = 0;
        if (solOut && tokensIn.length > 0) {
            const t = tokensIn[0];
            inMint = t.mint;
            inAmount = t.delta;
            outMint = null;
            outAmount = Math.abs(solChange);
        }
        else if (solIn && tokensOut.length > 0) {
            const t = tokensOut[0];
            inMint = null;
            inAmount = solChange;
            outMint = t.mint;
            outAmount = Math.abs(t.delta);
        }
        else if (tokensIn.length > 0 && tokensOut.length > 0) {
            inMint = tokensIn[0].mint;
            inAmount = tokensIn[0].delta;
            outMint = tokensOut[0].mint;
            outAmount = Math.abs(tokensOut[0].delta);
        }
        else {
            return null;
        }
        const type = inMint !== null && outMint !== null
            ? 'SWAP'
            : inMint !== null
                ? 'BUY'
                : 'SELL';
        const shortMint = (m) => `${m.slice(0, 6)}...${m.slice(-4)}`;
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
    formatTradeMessage(walletAddress, signature, action, label, extra) {
        const { type } = action;
        const emoji = type === 'BUY' ? '🟢' : type === 'SELL' ? '🔴' : '🔄';
        const labelLine = label ? `🏷 <b>${label}</b>\n` : '';
        const walletShort = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        const tokenLabel = (name, symbol) => name && symbol ? `${name} (${symbol})` : symbol || name || '???';
        const caLine = (mint) => `   📋 CA: <code>${mint ?? SOL_MINT}</code>\n`;
        const fmtAmount = (amount, symbol) => `<b>${amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol}</b>`;
        const usdLine = action.usdValue > 0
            ? `💵 Trade Value:  <b>~$${action.usdValue.toFixed(2)}</b>\n`
            : '';
        const paidPerToken = action.inMint && action.inAmount > 0 && action.usdValue > 0
            ? action.usdValue / action.inAmount
            : 0;
        const paidLine = paidPerToken > 0
            ? `💲 Paid/token:   <b>$${paidPerToken < 0.0001 ? paidPerToken.toExponential(4) : paidPerToken.toFixed(6)}</b>\n`
            : '';
        const marketLine = extra?.marketPrice && extra.marketPrice > 0
            ? `📊 Mkt price:    <b>$${extra.marketPrice < 0.0001 ? extra.marketPrice.toExponential(4) : extra.marketPrice.toFixed(6)}</b>\n`
            : '';
        let impactLine = '';
        if (extra?.priceImpact !== null && extra?.priceImpact !== undefined) {
            const pi = extra.priceImpact;
            const piEmoji = pi > 5 ? '🔴' : pi > 2 ? '🟡' : '🟢';
            impactLine = `${piEmoji} Price impact: <b>${pi >= 0 ? '+' : ''}${pi.toFixed(2)}%</b>\n`;
        }
        const solPriceLine = extra?.solPrice && extra.solPrice > 0
            ? `◎ SOL price:    <b>$${extra.solPrice.toFixed(2)}</b>\n`
            : '';
        const feeLine = extra && extra.txFeeSol > 0
            ? `⛽ Tx fee:       <b>${extra.txFeeSol.toFixed(6)} SOL</b>${extra.txFeeUsd > 0 ? ` (~$${extra.txFeeUsd.toFixed(4)})` : ''}\n`
            : '';
        const timeLine = extra?.txTime ? `🕐 <b>${extra.txTime}</b>\n` : '';
        const sigShort = `${signature.slice(0, 8)}...${signature.slice(-6)}`;
        const primaryMint = action.inMint ?? action.outMint;
        const links = primaryMint
            ? `<a href="https://dexscreener.com/solana/${primaryMint}">DexScreener</a>  ·  ` +
                `<a href="https://solscan.io/token/${primaryMint}">Solscan</a>  ·  ` +
                `<a href="https://birdeye.so/token/${primaryMint}?chain=solana">Birdeye</a>  ·  ` +
                `<a href="https://solscan.io/tx/${signature}">${sigShort}</a>`
            : `<a href="https://solscan.io/tx/${signature}">${sigShort}</a>`;
        return (`${emoji} <b>${type}</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            labelLine +
            `👛 <a href="https://solscan.io/account/${walletAddress}">${walletShort}</a>  ${timeLine}` +
            `\n` +
            `📤 <b>Spent</b>\n` +
            `   ${fmtAmount(action.outAmount, action.outSymbol)}\n` +
            `   🪙 ${tokenLabel(action.outName, action.outSymbol)}\n` +
            caLine(action.outMint) +
            `\n` +
            `📥 <b>Received</b>\n` +
            `   ${fmtAmount(action.inAmount, action.inSymbol)}\n` +
            `   🪙 ${tokenLabel(action.inName, action.inSymbol)}\n` +
            caLine(action.inMint) +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            usdLine +
            paidLine +
            marketLine +
            impactLine +
            solPriceLine +
            feeLine +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🔗 ${links}`);
    }
    async backfillTrades(address, limit) {
        try {
            new web3_js_1.PublicKey(address);
        }
        catch {
            return { success: false, message: 'Invalid Solana address' };
        }
        try {
            const sigsRes = await this.connection.getSignaturesForAddress(new web3_js_1.PublicKey(address), { limit });
            if (!sigsRes.length) {
                return { success: false, message: 'No transactions found' };
            }
            let processed = 0;
            let errors = 0;
            for (const sig of sigsRes) {
                try {
                    const tx = await this.connection.getParsedTransaction(sig.signature, {
                        maxSupportedTransactionVersion: 0,
                    });
                    if (!tx || sig.err)
                        continue;
                    const action = this.detectAction(tx, address);
                    if (!action)
                        continue;
                    await this.prisma.trade.upsert({
                        where: { signature: sig.signature },
                        create: {
                            walletAddress: address,
                            type: action.type,
                            tokenMint: action.tokenMint,
                            tokenSymbol: action.tokenSymbol,
                            tokenName: action.tokenName,
                            tokenAmount: action.tokenAmount,
                            solAmount: action.solAmount,
                            signature: sig.signature,
                            timestamp: sig.blockTime ? new Date(sig.blockTime * 1000) : new Date(),
                        },
                        update: {},
                    });
                    processed++;
                }
                catch {
                    errors++;
                }
            }
            return {
                success: true,
                message: `Backfilled ${processed} trades${errors > 0 ? ` (${errors} errors)` : ''}`,
            };
        }
        catch (err) {
            return { success: false, message: `Error: ${err.message}` };
        }
    }
    async getPnlAnalysis(address) {
        try {
            new web3_js_1.PublicKey(address);
        }
        catch {
            throw new Error('invalid_address');
        }
        const trades = await this.prisma.trade.findMany({
            where: { walletAddress: address },
            orderBy: { timestamp: 'asc' },
        });
        if (!trades.length)
            return '📭 No trades found for PnL analysis.';
        let totalBuyUsd = 0;
        let totalSellUsd = 0;
        let pnl = 0;
        for (const trade of trades) {
            if (trade.type === 'BUY') {
                totalBuyUsd += trade.totalUsd;
            }
            else if (trade.type === 'SELL') {
                totalSellUsd += trade.totalUsd;
            }
        }
        pnl = totalSellUsd - totalBuyUsd;
        const pnlPct = totalBuyUsd > 0 ? (pnl / totalBuyUsd) * 100 : 0;
        const emoji = pnl >= 0 ? '📈' : '📉';
        return [
            `┌─────────────────────────────`,
            `│ 📊 <b>PnL ANALYSIS</b>`,
            `│ 👛 ${address.slice(0, 6)}...${address.slice(-4)}`,
            `└─────────────────────────────\n`,
            `${emoji} <b>Total PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD</b>`,
            `� Total Bought: <b>${totalBuyUsd.toFixed(2)} USD</b>`,
            `📉 Total Sold: <b>${totalSellUsd.toFixed(2)} USD</b>`,
            `📊 Return: <b>${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</b>`,
            `🔢 Trades: <b>${trades.length}</b>`,
        ].join('\n');
    }
    bar(value, total) {
        if (total === 0)
            return '';
        const pct = value / total;
        const filled = Math.round(pct * 8);
        return ('▓'.repeat(filled) +
            '░'.repeat(8 - filled) +
            ` ${(pct * 100).toFixed(1)}%`);
    }
};
exports.SolanaService = SolanaService;
exports.SolanaService = SolanaService = SolanaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, nestjs_telegraf_1.InjectBot)()),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService,
        telegraf_1.Telegraf])
], SolanaService);
//# sourceMappingURL=solana.service.js.map