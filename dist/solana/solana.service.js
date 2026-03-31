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
const minTradeSize = new Map();
const walletLabels = new Map();
const allUsers = new Map();
const startTime = new Date();
let SolanaService = SolanaService_1 = class SolanaService {
    constructor(config, bot) {
        this.config = config;
        this.bot = bot;
        this.logger = new common_1.Logger(SolanaService_1.name);
        this.watchedWallets = new Map();
    }
    onModuleInit() {
        this.apiKey = this.config.get('HELIUS_API_KEY');
        const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
        const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${this.apiKey}`;
        this.connection = new web3_js_1.Connection(rpcUrl, {
            wsEndpoint: wsUrl,
            commitment: 'confirmed',
        });
        const envWallets = this.config.get('WATCHED_WALLETS', '');
        if (envWallets) {
            envWallets.split(',').forEach((addr) => {
                const trimmed = addr.trim();
                if (trimmed)
                    this.watchWallet(trimmed, null);
            });
        }
    }
    onModuleDestroy() {
        this.watchedWallets.forEach(({ subId }) => {
            this.connection.removeOnLogsListener(subId).catch(() => { });
        });
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
        if (this.watchedWallets.has(address)) {
            if (chatId)
                this.watchedWallets.get(address).chatIds.add(chatId);
            return true;
        }
        const subId = this.connection.onLogs(new web3_js_1.PublicKey(address), async (logs) => {
            if (logs.err)
                return;
            await this.handleTransaction(address, logs.signature);
        }, 'confirmed');
        const chatIds = new Set();
        if (chatId)
            chatIds.add(chatId);
        this.watchedWallets.set(address, { subId, chatIds });
        this.logger.log(`Watching wallet: ${address}`);
        return true;
    }
    unwatchWallet(address, chatId) {
        const entry = this.watchedWallets.get(address);
        if (!entry)
            return false;
        entry.chatIds.delete(chatId);
        if (entry.chatIds.size === 0) {
            this.connection.removeOnLogsListener(entry.subId).catch(() => { });
            this.watchedWallets.delete(address);
        }
        return true;
    }
    getWatchedWallets(chatId) {
        const result = [];
        const labels = walletLabels.get(chatId) ?? new Map();
        this.watchedWallets.forEach((entry, address) => {
            if (entry.chatIds.has(chatId)) {
                result.push({ address, label: labels.get(address) ?? '' });
            }
        });
        return result;
    }
    setWalletLabel(chatId, address, label) {
        const entry = this.watchedWallets.get(address);
        if (!entry || !entry.chatIds.has(chatId))
            return false;
        if (!walletLabels.has(chatId))
            walletLabels.set(chatId, new Map());
        walletLabels.get(chatId).set(address, label);
        return true;
    }
    getWalletLabel(chatId, address) {
        return walletLabels.get(chatId)?.get(address) ?? '';
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
    setMinTradeSize(chatId, usd) {
        minTradeSize.set(chatId, usd);
    }
    getMinTradeSize(chatId) {
        return minTradeSize.get(chatId) ?? 0;
    }
    trackUser(chatId, username) {
        const now = new Date();
        if (allUsers.has(chatId)) {
            allUsers.get(chatId).lastSeen = now;
        }
        else {
            allUsers.set(chatId, { username, firstSeen: now, lastSeen: now });
        }
    }
    getStats() {
        const totalUsers = allUsers.size;
        const totalWallets = this.watchedWallets.size;
        const activeWatchers = new Set();
        this.watchedWallets.forEach(({ chatIds }) => chatIds.forEach((id) => activeWatchers.add(id)));
        const uptimeMs = Date.now() - startTime.getTime();
        const hours = Math.floor(uptimeMs / 3600000);
        const minutes = Math.floor((uptimeMs % 3600000) / 60000);
        return [
            `┌─────────────────────────────`,
            `│ 📊 <b>BOT STATS</b>`,
            `└─────────────────────────────\n`,
            `👥 Total users: <b>${totalUsers}</b>`,
            `👁 Active watchers: <b>${activeWatchers.size}</b>`,
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
            `│ � <a href="https://solscan.io/account/${address}">${short}</a>`,
            `│ Last ${sigsRes.length} transactions`,
            `└─────────────────────────────\n`,
        ];
        const DEX_PROGRAMS = [
            'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
            '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
            'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
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
                const instructions = tx.transaction.message.instructions;
                const isSwap = instructions.some((ix) => DEX_PROGRAMS.includes(ix.programId?.toString()));
                const accountKeys = tx.transaction.message.accountKeys;
                const walletIndex = accountKeys.findIndex((k) => k.pubkey?.toString() === address || k.toString() === address);
                if (isSwap && walletIndex !== -1) {
                    const solChange = ((tx.meta?.postBalances?.[walletIndex] ?? 0) -
                        (tx.meta?.preBalances?.[walletIndex] ?? 0)) /
                        1e9;
                    const isBuy = solChange < -0.001;
                    const isSell = solChange > 0.001;
                    if (isBuy || isSell) {
                        typeLabel = isBuy ? '🟢 BUY' : '🔴 SELL';
                        const solAmt = Math.abs(solChange);
                        const usdAmt = solAmt * solPrice;
                        const pre = tx.meta?.preTokenBalances || [];
                        const post = tx.meta?.postTokenBalances || [];
                        const changed = post.find((p) => p.owner === address &&
                            pre.some((r) => r.mint === p.mint &&
                                r.uiTokenAmount.uiAmount !== p.uiTokenAmount.uiAmount));
                        if (changed) {
                            const preEntry = pre.find((r) => r.mint === changed.mint && r.owner === address);
                            const tokenAmt = Math.abs((changed.uiTokenAmount.uiAmount ?? 0) -
                                (preEntry?.uiTokenAmount.uiAmount ?? 0));
                            const mintShort = `${changed.mint.slice(0, 6)}...${changed.mint.slice(-4)}`;
                            const pricePerToken = tokenAmt > 0 ? usdAmt / tokenAmt : 0;
                            detailLines = [
                                `   🪙 Token: <a href="https://solscan.io/token/${changed.mint}">${mintShort}</a>`,
                                `   💰 ${tokenAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens`,
                                `   ◎ ${solAmt.toFixed(4)} SOL  ·  <b>~$${usdAmt.toFixed(2)}</b>`,
                                pricePerToken > 0
                                    ? `   📊 $${pricePerToken < 0.0001 ? pricePerToken.toExponential(3) : pricePerToken.toFixed(6)} per token`
                                    : '',
                            ].filter(Boolean);
                        }
                        else {
                            detailLines = [
                                `   ◎ ${solAmt.toFixed(4)} SOL  ·  <b>~$${usdAmt.toFixed(2)}</b>`,
                            ];
                        }
                    }
                }
                else if (walletIndex !== -1) {
                    const solChange = ((tx.meta?.postBalances?.[walletIndex] ?? 0) -
                        (tx.meta?.preBalances?.[walletIndex] ?? 0)) /
                        1e9;
                    if (Math.abs(solChange) > 0.000001) {
                        const dir = solChange > 0 ? '📥 Received' : '📤 Sent';
                        typeLabel = dir;
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
            const entry = this.watchedWallets.get(walletAddress);
            if (!entry)
                return;
            entry.chatIds.forEach((chatId) => {
                const min = minTradeSize.get(chatId) ?? 0;
                if (action.usdValue < min)
                    return;
                const label = this.getWalletLabel(chatId, walletAddress);
                const message = this.formatTradeMessage(walletAddress, signature, action, label);
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
            });
        }
        catch (err) {
            this.logger.error(`Error handling tx ${signature}: ${err.message}`);
        }
    }
    detectAction(tx, walletAddress) {
        const DEX_PROGRAMS = [
            'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
            '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
            'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
        ];
        const isSwap = tx.transaction.message.instructions.some((ix) => DEX_PROGRAMS.includes(ix.programId?.toString()));
        if (!isSwap)
            return null;
        const accountKeys = tx.transaction.message.accountKeys;
        const walletIndex = accountKeys.findIndex((k) => k.pubkey?.toString() === walletAddress ||
            k.toString() === walletAddress);
        if (walletIndex === -1)
            return null;
        const solChange = ((tx.meta?.postBalances?.[walletIndex] ?? 0) -
            (tx.meta?.preBalances?.[walletIndex] ?? 0)) /
            1e9;
        const type = solChange < -0.001 ? 'BUY' : solChange > 0.001 ? 'SELL' : null;
        if (!type)
            return null;
        const preTokenBalances = tx.meta?.preTokenBalances || [];
        const postTokenBalances = tx.meta?.postTokenBalances || [];
        let tokenSymbol = 'Unknown';
        let tokenMint = '';
        let tokenAmount = 0;
        const changedToken = postTokenBalances.find((post) => post.owner === walletAddress &&
            preTokenBalances.some((pre) => pre.mint === post.mint &&
                pre.uiTokenAmount.uiAmount !== post.uiTokenAmount.uiAmount));
        if (changedToken) {
            tokenMint = changedToken.mint;
            tokenSymbol = `${changedToken.mint.slice(0, 6)}...${changedToken.mint.slice(-4)}`;
            const pre = preTokenBalances.find((p) => p.mint === changedToken.mint && p.owner === walletAddress);
            tokenAmount = Math.abs((changedToken.uiTokenAmount.uiAmount ?? 0) -
                (pre?.uiTokenAmount.uiAmount ?? 0));
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
    formatTradeMessage(walletAddress, signature, action, label) {
        const isBuy = action.type === 'BUY';
        const emoji = isBuy ? '🟢' : '🔴';
        const labelLine = label ? `🏷 <b>${label}</b>\n` : '';
        const short = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
        const usdLine = action.usdValue > 0
            ? `💵 Value: <b>~$${action.usdValue.toFixed(2)}</b>\n`
            : '';
        const tokenAmountLine = action.tokenAmount > 0
            ? `🪙 Tokens: <b>${action.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>\n`
            : '';
        const pricePerToken = action.tokenAmount > 0 && action.usdValue > 0
            ? `📊 Price paid: <b>$${(action.usdValue / action.tokenAmount).toExponential(4)}</b> per token\n`
            : '';
        const links = action.tokenMint
            ? `🔗 <a href="https://dexscreener.com/solana/${action.tokenMint}">Chart</a>  ·  <a href="https://solscan.io/token/${action.tokenMint}">Token</a>  ·  <a href="https://solscan.io/tx/${signature}">TX</a>`
            : `🔗 <a href="https://solscan.io/tx/${signature}">View Transaction</a>`;
        return (`${emoji} <b>${isBuy ? '🟢 BUY' : '🔴 SELL'}</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            labelLine +
            `👛 <a href="https://solscan.io/account/${walletAddress}">${short}</a>\n` +
            `🏷 Token: <b>${action.tokenSymbol}</b>\n` +
            tokenAmountLine +
            `◎ SOL: <b>${action.solAmount.toFixed(4)} SOL</b>\n` +
            usdLine +
            pricePerToken +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            links);
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
    __param(1, (0, nestjs_telegraf_1.InjectBot)()),
    __metadata("design:paramtypes", [config_1.ConfigService,
        telegraf_1.Telegraf])
], SolanaService);
//# sourceMappingURL=solana.service.js.map