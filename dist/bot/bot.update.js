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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotUpdate = void 0;
const nestjs_telegraf_1 = require("nestjs-telegraf");
const telegraf_1 = require("telegraf");
const solana_service_1 = require("../solana/solana.service");
const persistentKeyboard = {
    keyboard: [
        [
            { text: '➕ Track Wallet' },
            { text: '📋 List Wallets' },
            { text: '🏠 Menu' },
        ],
    ],
    resize_keyboard: true,
    is_persistent: true,
};
const pendingAction = new Map();
const pendingLabelAddress = new Map();
const MAIN_MENU_TEXT = `🏠 <b>Sol Wallet Watcher</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👁 <b>Watch Wallet</b> — track a new wallet\n` +
    `📋 <b>My List</b> — view & manage your wallets\n` +
    `💼 <b>Portfolio</b> — see all tokens & their value\n` +
    `📜 <b>TX History</b> — last 10 transactions\n` +
    `💲 <b>Token Price</b> — check any token price\n` +
    `⚙️ <b>Min Size</b> — filter small trade alerts\n` +
    `📊 <b>Stats</b> — bot usage overview`;
function mainMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '👁 Watch Wallet', callback_data: 'menu_watch' },
                { text: '📋 My List', callback_data: 'menu_list' },
            ],
            [
                { text: '💼 Portfolio', callback_data: 'menu_portfolio' },
                { text: '📜 TX History', callback_data: 'menu_txhistory' },
            ],
            [
                { text: '💲 Token Price', callback_data: 'menu_price' },
                { text: '⚙️ Min Size', callback_data: 'menu_minsize' },
            ],
            [
                { text: '📊 Stats', callback_data: 'menu_stats' },
                { text: '❓ Help', callback_data: 'menu_help' },
            ],
        ],
    };
}
function walletKeyboard(address) {
    return {
        inline_keyboard: [
            [
                { text: '💼 Portfolio', callback_data: `wallet_portfolio:${address}` },
                { text: '📜 TX History', callback_data: `wallet_txhistory:${address}` },
            ],
            [
                { text: '🏷 Label', callback_data: `wallet_label:${address}` },
                { text: '🗑 Unwatch', callback_data: `wallet_unwatch:${address}` },
            ],
            [
                { text: '� Solscan', url: `https://solscan.io/account/${address}` },
                {
                    text: '� DexScreener',
                    url: `https://dexscreener.com/solana/${address}`,
                },
            ],
            [{ text: '◀️ Back to List', callback_data: 'menu_list' }],
        ],
    };
}
let BotUpdate = class BotUpdate {
    constructor(solanaService) {
        this.solanaService = solanaService;
    }
    extractArg(ctx) {
        const text = ctx.message?.text || '';
        const parts = text.trim().split(/\s+/);
        return parts[1] || null;
    }
    trackUser(ctx) {
        const chatId = ctx.chat?.id;
        if (!chatId)
            return;
        this.solanaService.trackUser(chatId, ctx.from?.username || '');
    }
    buildWalletListContent(chatId) {
        const wallets = this.solanaService.getWatchedWallets(chatId);
        const min = this.solanaService.getMinTradeSize(chatId);
        const filterLine = min > 0 ? `\n⚙️ Min alert: <b>$${min}</b>` : '';
        if (wallets.length === 0) {
            return {
                text: `� <b>No wallets watched yet</b>\n\nUse /watch to add one.`,
                keyboard: mainMenuKeyboard(),
            };
        }
        const buttons = wallets.map((w) => {
            const short = `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
            const btnLabel = w.label ? `🏷 ${w.label}  •  ${short}` : `👛 ${short}`;
            return [{ text: btnLabel, callback_data: `wallet_open:${w.address}` }];
        });
        buttons.push([{ text: '� Main Menu', callback_data: 'menu_main' }]);
        return {
            text: `👁 <b>Watched Wallets</b> (${wallets.length})${filterLine}\n━━━━━━━━━━━━━━━━━━━━\nTap a wallet to manage it:`,
            keyboard: { inline_keyboard: buttons },
        };
    }
    async onStart(ctx) {
        this.trackUser(ctx);
        const username = ctx.from?.first_name || 'Trader';
        await ctx.reply(`� <b>Welcome, ${username}!</b>\n\n` +
            `🔭 <b>Sol Wallet Watcher</b> is a real-time Solana wallet tracker.\n\n` +
            `⚡ <b>What it does:</b>\n` +
            `• Watches any Solana wallet 24/7\n` +
            `• Sends instant alerts when they buy or sell\n` +
            `• Shows token portfolio & USD value\n` +
            `• Tracks transaction history with trade details\n` +
            `• Checks live token prices\n\n` +
            `⚠️ <b>Solana only</b> — ETH, BTC and other chains are not supported.\n\n` +
            `Use the menu below to get started 👇`, { parse_mode: 'HTML', reply_markup: persistentKeyboard });
        await ctx.reply(`🏠 <b>Main Menu</b>`, {
            parse_mode: 'HTML',
            reply_markup: mainMenuKeyboard(),
        });
    }
    async onHelp(ctx) {
        await ctx.reply(`📖 <b>Commands</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `/watch /unwatch /list /label\n` +
            `/portfolio /txhistory /price\n` +
            `/minsize /stats /menu`, { parse_mode: 'HTML' });
    }
    async onMenu(ctx) {
        await ctx.reply(`🏠 <b>Main Menu</b>`, {
            parse_mode: 'HTML',
            reply_markup: mainMenuKeyboard(),
        });
    }
    async onWatch(ctx) {
        this.trackUser(ctx);
        const address = this.extractArg(ctx);
        if (address) {
            await this.addWallet(ctx, address);
            return;
        }
        pendingAction.set(ctx.chat.id, 'watch');
        await ctx.reply(`👛 <b>Add Wallet</b>\n\nPaste the Solana wallet address you want to watch:`, { parse_mode: 'HTML' });
    }
    async onUnwatch(ctx) {
        const address = this.extractArg(ctx);
        if (address) {
            await this.removeWallet(ctx, address);
            return;
        }
        const wallets = this.solanaService.getWatchedWallets(ctx.chat.id);
        if (wallets.length === 0) {
            await ctx.reply('You have no wallets being watched.');
            return;
        }
        pendingAction.set(ctx.chat.id, 'unwatch');
        const list = wallets
            .map((w, i) => {
            const name = w.label ? ` — <b>${w.label}</b>` : '';
            return `${i + 1}.${name} <code>${w.address}</code>`;
        })
            .join('\n');
        await ctx.reply(`� <b>Remove Wallet</b>\n\nPaste the address to remove:\n\n${list}`, { parse_mode: 'HTML' });
    }
    async onList(ctx) {
        const { text, keyboard } = this.buildWalletListContent(ctx.chat.id);
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
    async onLabel(ctx) {
        const wallets = this.solanaService.getWatchedWallets(ctx.chat.id);
        if (wallets.length === 0) {
            await ctx.reply(`📭 No wallets to label. Use /watch first.`);
            return;
        }
        pendingAction.set(ctx.chat.id, 'label_address');
        const list = wallets
            .map((w, i) => {
            const short = `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
            const name = w.label ? ` — <b>${w.label}</b>` : '';
            return `${i + 1}. ${short}${name}\n   <code>${w.address}</code>`;
        })
            .join('\n\n');
        await ctx.reply(`🏷 <b>Label a Wallet</b>\n\nPaste the address you want to name:\n\n${list}`, { parse_mode: 'HTML' });
    }
    async onPortfolio(ctx) {
        const address = this.extractArg(ctx);
        if (address) {
            await this.showPortfolio(ctx, address);
            return;
        }
        pendingAction.set(ctx.chat.id, 'portfolio');
        await ctx.reply(`💼 <b>Portfolio Lookup</b>\n\nPaste the Solana wallet address to check:`, { parse_mode: 'HTML' });
    }
    async onTxHistory(ctx) {
        const address = this.extractArg(ctx);
        if (address) {
            await this.showTxHistory(ctx, address);
            return;
        }
        pendingAction.set(ctx.chat.id, 'txhistory');
        await ctx.reply(`📜 <b>Transaction History</b>\n\nPaste the Solana wallet address:`, { parse_mode: 'HTML' });
    }
    async onPrice(ctx) {
        const arg = this.extractArg(ctx);
        if (arg) {
            await this.showPrice(ctx, arg);
            return;
        }
        pendingAction.set(ctx.chat.id, 'price');
        await ctx.reply(`� <b>Token Price</b>\n\nPaste a token mint address or symbol:`, { parse_mode: 'HTML' });
    }
    async onStats(ctx) {
        this.trackUser(ctx);
        await ctx.reply(this.solanaService.getStats(), { parse_mode: 'HTML' });
    }
    async onMinSize(ctx) {
        const arg = this.extractArg(ctx);
        if (arg) {
            await this.setMinSize(ctx, arg);
            return;
        }
        const current = this.solanaService.getMinTradeSize(ctx.chat.id);
        pendingAction.set(ctx.chat.id, 'minsize');
        await ctx.reply(`⚙️ <b>Minimum Alert Size</b>\n\nCurrent: <b>${current > 0 ? `$${current}` : 'All trades'}</b>\n\nEnter a USD amount or <b>0</b> for all:`, { parse_mode: 'HTML' });
    }
    async onMenuMain(ctx) {
        await ctx.answerCbQuery();
        await ctx.editMessageText(`🏠 <b>Main Menu</b>`, {
            parse_mode: 'HTML',
            reply_markup: mainMenuKeyboard(),
        });
    }
    async onMenuWatch(ctx) {
        await ctx.answerCbQuery();
        pendingAction.set(ctx.chat.id, 'watch');
        await ctx.reply(`� <b>Add Wallet</b>\n\nPaste the Solana wallet address you want to watch:`, { parse_mode: 'HTML' });
    }
    async onMenuList(ctx) {
        await ctx.answerCbQuery();
        const { text, keyboard } = this.buildWalletListContent(ctx.chat.id);
        try {
            await ctx.editMessageText(text, {
                parse_mode: 'HTML',
                reply_markup: keyboard,
            });
        }
        catch {
            await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
        }
    }
    async onMenuPortfolio(ctx) {
        await ctx.answerCbQuery();
        pendingAction.set(ctx.chat.id, 'portfolio');
        await ctx.reply(`💼 <b>Portfolio Lookup</b>\n\nPaste the Solana wallet address to check:`, { parse_mode: 'HTML' });
    }
    async onMenuTxHistory(ctx) {
        await ctx.answerCbQuery();
        pendingAction.set(ctx.chat.id, 'txhistory');
        await ctx.reply(`📜 <b>Transaction History</b>\n\nPaste the Solana wallet address:`, { parse_mode: 'HTML' });
    }
    async onMenuPrice(ctx) {
        await ctx.answerCbQuery();
        pendingAction.set(ctx.chat.id, 'price');
        await ctx.reply(`💲 <b>Token Price</b>\n\nPaste a token mint address or symbol:`, { parse_mode: 'HTML' });
    }
    async onMenuMinSize(ctx) {
        await ctx.answerCbQuery();
        const current = this.solanaService.getMinTradeSize(ctx.chat.id);
        pendingAction.set(ctx.chat.id, 'minsize');
        await ctx.reply(`⚙️ <b>Minimum Alert Size</b>\n\nCurrent: <b>${current > 0 ? `$${current}` : 'All trades'}</b>\n\nEnter a USD amount or <b>0</b> for all:`, { parse_mode: 'HTML' });
    }
    async onMenuStats(ctx) {
        await ctx.answerCbQuery();
        await ctx.reply(this.solanaService.getStats(), { parse_mode: 'HTML' });
    }
    async onMenuHelp(ctx) {
        await ctx.answerCbQuery();
        await ctx.reply(`📖 <b>Commands</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `/watch /unwatch /list /label\n/portfolio /txhistory /price\n/minsize /stats /menu`, { parse_mode: 'HTML' });
    }
    async onWalletOpen(ctx) {
        await ctx.answerCbQuery();
        const address = ctx.match[1];
        const label = this.solanaService.getWalletLabel(ctx.chat.id, address);
        const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
        const name = label ? `🏷 <b>${label}</b>\n` : '';
        await ctx.editMessageText(`${name}� <a href="https://solscan.io/account/${address}">${short}</a>\n<code>${address}</code>`, { parse_mode: 'HTML', reply_markup: walletKeyboard(address) });
    }
    async onWalletPortfolio(ctx) {
        await ctx.answerCbQuery();
        await this.showPortfolio(ctx, ctx.match[1]);
    }
    async onWalletTxHistory(ctx) {
        await ctx.answerCbQuery();
        await this.showTxHistory(ctx, ctx.match[1]);
    }
    async onWalletUnwatch(ctx) {
        await ctx.answerCbQuery();
        await this.removeWallet(ctx, ctx.match[1]);
    }
    async onWalletLabel(ctx) {
        await ctx.answerCbQuery();
        const address = ctx.match[1];
        pendingLabelAddress.set(ctx.chat.id, address);
        pendingAction.set(ctx.chat.id, 'label_name');
        const existing = this.solanaService.getWalletLabel(ctx.chat.id, address);
        const current = existing ? ` (current: <b>${existing}</b>)` : '';
        await ctx.reply(`🏷 Enter a name for this wallet${current}:\n<code>${address}</code>`, { parse_mode: 'HTML' });
    }
    async onText(ctx, text) {
        if (text.startsWith('/'))
            return;
        const chatId = ctx.chat.id;
        this.trackUser(ctx);
        if (text === '➕ Track Wallet') {
            pendingAction.set(chatId, 'watch');
            await ctx.reply(`👛 <b>Add Wallet</b>\n\nPaste the Solana wallet address you want to watch:`, { parse_mode: 'HTML' });
            return;
        }
        if (text === '📋 List Wallets') {
            const { text: listText, keyboard } = this.buildWalletListContent(chatId);
            await ctx.reply(listText, { parse_mode: 'HTML', reply_markup: keyboard });
            return;
        }
        if (text === '🏠 Menu') {
            await ctx.reply(`🏠 <b>Main Menu</b>`, {
                parse_mode: 'HTML',
                reply_markup: mainMenuKeyboard(),
            });
            return;
        }
        const action = pendingAction.get(chatId);
        if (!action)
            return;
        pendingAction.delete(chatId);
        const input = text.trim();
        if (action === 'watch')
            await this.addWallet(ctx, input);
        else if (action === 'unwatch')
            await this.removeWallet(ctx, input);
        else if (action === 'portfolio')
            await this.showPortfolio(ctx, input);
        else if (action === 'txhistory')
            await this.showTxHistory(ctx, input);
        else if (action === 'price')
            await this.showPrice(ctx, input);
        else if (action === 'minsize')
            await this.setMinSize(ctx, input);
        else if (action === 'label_address') {
            const chainErr = this.solanaService.chainErrorMessage(input);
            if (chainErr) {
                await ctx.reply(chainErr, { parse_mode: 'HTML' });
                return;
            }
            const wallets = this.solanaService.getWatchedWallets(chatId);
            const found = wallets.find((w) => w.address === input);
            if (!found) {
                await ctx.reply(`❌ That address isn't in your watch list.`);
                return;
            }
            pendingLabelAddress.set(chatId, input);
            pendingAction.set(chatId, 'label_name');
            const current = found.label ? ` (current: <b>${found.label}</b>)` : '';
            await ctx.reply(`🏷 Enter a name for this wallet${current}:\n<code>${input}</code>`, { parse_mode: 'HTML' });
        }
        else if (action === 'label_name') {
            const address = pendingLabelAddress.get(chatId);
            pendingLabelAddress.delete(chatId);
            if (!address) {
                await ctx.reply('❌ Something went wrong. Try /label again.');
                return;
            }
            const success = this.solanaService.setWalletLabel(chatId, address, input);
            if (!success) {
                await ctx.reply('❌ Could not set label. Try /label again.');
                return;
            }
            const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
            await ctx.reply(`✅ <b>Label saved</b>\n\n👛 ${short} is now called <b>${input}</b>`, { parse_mode: 'HTML' });
        }
    }
    async addWallet(ctx, address) {
        try {
            const chainErr = this.solanaService.chainErrorMessage(address);
            if (chainErr) {
                await ctx.reply(chainErr, { parse_mode: 'HTML' });
                return;
            }
            const success = await this.solanaService.watchWallet(address, ctx.chat.id);
            if (!success) {
                await ctx.reply(`❌ <b>Invalid address</b>\n\nNot a valid Solana wallet.`, { parse_mode: 'HTML' });
                return;
            }
            const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
            await ctx.reply(`✅ <b>Wallet Added</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                `👛 <a href="https://solscan.io/account/${address}">${short}</a>\n` +
                `<code>${address}</code>\n\n` +
                `You'll be notified on every buy and sell.\n💡 Use /label to give this wallet a name.`, { parse_mode: 'HTML', reply_markup: walletKeyboard(address) });
        }
        catch {
            await ctx.reply(`❌ Something went wrong. Please try again.`);
        }
    }
    async removeWallet(ctx, address) {
        const success = this.solanaService.unwatchWallet(address, ctx.chat.id);
        if (!success) {
            await ctx.reply(`❌ That wallet isn't in your watch list.`);
            return;
        }
        const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
        await ctx.reply(`🗑 <b>Wallet Removed</b>\n\n<code>${short}</code> is no longer being watched.`, { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() });
    }
    async showPortfolio(ctx, address) {
        const chainErr = this.solanaService.chainErrorMessage(address);
        if (chainErr) {
            await ctx.reply(chainErr, { parse_mode: 'HTML' });
            return;
        }
        const loading = await ctx.reply('⏳ Fetching portfolio data...');
        try {
            const result = await this.solanaService.getPortfolio(address);
            await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, result, {
                parse_mode: 'HTML',
                reply_markup: walletKeyboard(address),
            });
        }
        catch {
            await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, `❌ Failed to fetch portfolio. Please try again.`, { parse_mode: 'HTML' });
        }
    }
    async showTxHistory(ctx, address) {
        const chainErr = this.solanaService.chainErrorMessage(address);
        if (chainErr) {
            await ctx.reply(chainErr, { parse_mode: 'HTML' });
            return;
        }
        const loading = await ctx.reply('⏳ Loading transaction history...');
        try {
            const result = await this.solanaService.getTxHistory(address);
            await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, result, {
                parse_mode: 'HTML',
                reply_markup: walletKeyboard(address),
            });
        }
        catch {
            await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, `❌ Failed to load history. Please try again.`, { parse_mode: 'HTML' });
        }
    }
    async showPrice(ctx, mintOrSymbol) {
        const loading = await ctx.reply('⏳ Fetching price...');
        try {
            const result = await this.solanaService.getTokenPrice(mintOrSymbol);
            await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, result, { parse_mode: 'HTML' });
        }
        catch {
            await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, `❌ Could not find price for <code>${mintOrSymbol}</code>.`, { parse_mode: 'HTML' });
        }
    }
    async setMinSize(ctx, input) {
        const value = parseFloat(input);
        if (isNaN(value) || value < 0) {
            await ctx.reply(`❌ Enter a number like <code>100</code> or <code>0</code> to disable.`, { parse_mode: 'HTML' });
            return;
        }
        this.solanaService.setMinTradeSize(ctx.chat.id, value);
        await ctx.reply(value === 0
            ? `✅ <b>Filter removed</b> — you'll receive all trade alerts.`
            : `✅ <b>Min alert size: $${value}</b>\n\nOnly trades above this value will notify you.`, { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() });
    }
};
exports.BotUpdate = BotUpdate;
__decorate([
    (0, nestjs_telegraf_1.Start)(),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onStart", null);
__decorate([
    (0, nestjs_telegraf_1.Command)('help'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onHelp", null);
__decorate([
    (0, nestjs_telegraf_1.Command)('menu'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onMenu", null);
__decorate([
    (0, nestjs_telegraf_1.Command)('watch'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onWatch", null);
__decorate([
    (0, nestjs_telegraf_1.Command)('unwatch'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onUnwatch", null);
__decorate([
    (0, nestjs_telegraf_1.Command)('list'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onList", null);
__decorate([
    (0, nestjs_telegraf_1.Command)('label'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onLabel", null);
__decorate([
    (0, nestjs_telegraf_1.Command)('portfolio'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onPortfolio", null);
__decorate([
    (0, nestjs_telegraf_1.Command)('txhistory'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onTxHistory", null);
__decorate([
    (0, nestjs_telegraf_1.Command)('price'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onPrice", null);
__decorate([
    (0, nestjs_telegraf_1.Command)('stats'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onStats", null);
__decorate([
    (0, nestjs_telegraf_1.Command)('minsize'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onMinSize", null);
__decorate([
    (0, nestjs_telegraf_1.Action)('menu_main'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onMenuMain", null);
__decorate([
    (0, nestjs_telegraf_1.Action)('menu_watch'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onMenuWatch", null);
__decorate([
    (0, nestjs_telegraf_1.Action)('menu_list'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onMenuList", null);
__decorate([
    (0, nestjs_telegraf_1.Action)('menu_portfolio'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onMenuPortfolio", null);
__decorate([
    (0, nestjs_telegraf_1.Action)('menu_txhistory'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onMenuTxHistory", null);
__decorate([
    (0, nestjs_telegraf_1.Action)('menu_price'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onMenuPrice", null);
__decorate([
    (0, nestjs_telegraf_1.Action)('menu_minsize'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onMenuMinSize", null);
__decorate([
    (0, nestjs_telegraf_1.Action)('menu_stats'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onMenuStats", null);
__decorate([
    (0, nestjs_telegraf_1.Action)('menu_help'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onMenuHelp", null);
__decorate([
    (0, nestjs_telegraf_1.Action)(/^wallet_open:(.+)$/),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onWalletOpen", null);
__decorate([
    (0, nestjs_telegraf_1.Action)(/^wallet_portfolio:(.+)$/),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onWalletPortfolio", null);
__decorate([
    (0, nestjs_telegraf_1.Action)(/^wallet_txhistory:(.+)$/),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onWalletTxHistory", null);
__decorate([
    (0, nestjs_telegraf_1.Action)(/^wallet_unwatch:(.+)$/),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onWalletUnwatch", null);
__decorate([
    (0, nestjs_telegraf_1.Action)(/^wallet_label:(.+)$/),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onWalletLabel", null);
__decorate([
    (0, nestjs_telegraf_1.On)('text'),
    __param(0, (0, nestjs_telegraf_1.Ctx)()),
    __param(1, (0, nestjs_telegraf_1.Message)('text')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [telegraf_1.Context, String]),
    __metadata("design:returntype", Promise)
], BotUpdate.prototype, "onText", null);
exports.BotUpdate = BotUpdate = __decorate([
    (0, nestjs_telegraf_1.Update)(),
    __metadata("design:paramtypes", [solana_service_1.SolanaService])
], BotUpdate);
//# sourceMappingURL=bot.update.js.map