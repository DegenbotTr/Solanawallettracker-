import {
  Update,
  Start,
  Command,
  Ctx,
  On,
  Message,
  Action,
} from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { InlineKeyboardMarkup, ReplyKeyboardMarkup } from 'telegraf/types';
import { SolanaService } from '../solana/solana.service';

// Persistent bottom keyboard — always visible above the text input
const persistentKeyboard: ReplyKeyboardMarkup = {
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

type PendingAction =
  | 'watch'
  | 'unwatch'
  | 'portfolio'
  | 'pnl'
  | 'txhistory'
  | 'price'
  | 'minsize'
  | 'label_address'
  | 'label_name'
  | 'tag_address'
  | 'tag_name'
  | 'untag_address'
  | 'untag_name'
  | 'filter_tag'
  | 'wallet_minsize';

const pendingAction = new Map<number, PendingAction>();
const pendingLabelAddress = new Map<number, string>();
const pendingTagAddress = new Map<number, string>();
const pendingWalletMinsizeAddress = new Map<number, string>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isGroup(ctx: Context): boolean {
  const type = ctx.chat?.type;
  return type === 'group' || type === 'supergroup';
}

async function isGroupAdmin(ctx: Context): Promise<boolean> {
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return ['creator', 'administrator'].includes(member.status);
  } catch {
    return false;
  }
}

// ─── Keyboards ────────────────────────────────────────────────────────────────

const MAIN_MENU_TEXT =
  `🏠 <b>Sol Wallet Watcher</b>\n` +
  `━━━━━━━━━━━━━━━━━━━━\n` +
  `👁 <b>Watch Wallet</b> — track a new wallet\n` +
  `📋 <b>My List</b> — view & manage your wallets\n` +
  `💼 <b>Portfolio</b> — see all tokens & their value\n` +
  `📜 <b>TX History</b> — last 10 transactions\n` +
  `💲 <b>Token Price</b> — check any token price\n` +
  `⚙️ <b>Min Size</b> — filter small trade alerts\n` +
  `📊 <b>Stats</b> — bot usage overview`;

function mainMenuKeyboard(): InlineKeyboardMarkup {
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

function walletKeyboard(address: string, paused = false): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '💼 Portfolio', callback_data: `wallet_portfolio:${address}` },
        { text: '📊 PnL Analysis', callback_data: `wallet_pnl:${address}` },
      ],
      [
        { text: '📜 TX History', callback_data: `wallet_txhistory:${address}` },
        {
          text: '🔄 Backfill Trades',
          callback_data: `wallet_backfill:${address}`,
        },
      ],
      [
        { text: '🏷 Label', callback_data: `wallet_label:${address}` },
        { text: '🏴 Tags', callback_data: `wallet_tags:${address}` },
      ],
      [
        { text: '⚙️ Min Size', callback_data: `wallet_minsize:${address}` },
        {
          text: paused ? '▶️ Unpause' : '⏸ Pause',
          callback_data: paused
            ? `wallet_unpause:${address}`
            : `wallet_pause:${address}`,
        },
        { text: '🗑 Unwatch', callback_data: `wallet_unwatch:${address}` },
      ],
      [{ text: '◀️ Back to List', callback_data: 'menu_list' }],
    ],
  };
}

@Update()
export class BotUpdate {
  constructor(private solanaService: SolanaService) {}

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private extractArg(ctx: Context): string | null {
    const text = (ctx.message as any)?.text || '';
    const parts = text.trim().split(/\s+/);
    return parts[1] || null;
  }

  private async trackUser(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await this.solanaService.trackUser(
      chatId,
      (ctx.from as any)?.username || '',
    );
  }

  private async buildWalletListContent(chatId: number): Promise<{
    text: string;
    keyboard: InlineKeyboardMarkup;
  }> {
    const wallets = await this.solanaService.getWatchedWallets(chatId);
    const min = await this.solanaService.getMinTradeSize(chatId);
    const filterLine = min > 0 ? `\n⚙️ Min alert: <b>$${min}</b>` : '';

    if (wallets.length === 0) {
      return {
        text: ` <b>No wallets watched yet</b>\n\nUse /watch to add one.`,
        keyboard: mainMenuKeyboard(),
      };
    }

    const buttons = wallets.map((w) => {
      const short = `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
      const btnLabel = w.label ? `🏷 ${w.label}  •  ${short}` : `👛 ${short}`;
      return [{ text: btnLabel, callback_data: `wallet_open:${w.address}` }];
    });
    buttons.push([{ text: ' Main Menu', callback_data: 'menu_main' }]);

    return {
      text: `👁 <b>Watched Wallets</b> (${wallets.length})${filterLine}\n━━━━━━━━━━━━━━━━━━━━\nTap a wallet to manage it:`,
      keyboard: { inline_keyboard: buttons },
    };
  }

  // ─── Start / Help ─────────────────────────────────────────────────────────────

  @Start()
  async onStart(@Ctx() ctx: Context): Promise<void> {
    await this.trackUser(ctx);
    const username = (ctx.from as any)?.first_name || 'Trader';

    // Handle deep link: /start token_MINTADDRESS
    const payload = (ctx.message as any)?.text?.split(' ')[1];
    if (payload?.startsWith('token_')) {
      const mint = payload.slice(6);
      await this.showTokenInfo(ctx, mint);
      return;
    }

    if (isGroup(ctx)) {
      await ctx.reply(
        `👁 <b>Sol Wallet Watcher</b> is now active in this group!\n\n` +
          `Use <code>/watch &lt;address&gt;</code> to track a Solana wallet.\n` +
          `Use <code>/unwatch &lt;address&gt;</code> to stop tracking.\n` +
          `Use <code>/list</code> to see all watched wallets.\n\n` +
          `⚠️ Solana wallets only.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    await ctx.reply(
      `👋 <b>Welcome, ${username}!</b>\n\n` +
        `🔭 <b>Sol Wallet Watcher</b> is a real-time Solana wallet tracker.\n\n` +
        `⚡ <b>What it does:</b>\n` +
        `• Watches any Solana wallet 24/7\n` +
        `• Sends instant alerts when they buy or sell\n` +
        `• Shows token portfolio & USD value\n` +
        `• Tracks transaction history with trade details\n` +
        `• Checks live token prices\n\n` +
        `⚠️ <b>Solana only</b> — ETH, BTC and other chains are not supported.\n\n` +
        `Use the menu below to get started 👇`,
      { parse_mode: 'HTML', reply_markup: persistentKeyboard },
    );

    await ctx.reply(`🏠 <b>Main Menu</b>`, {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
    });
  }

  @Command('help')
  async onHelp(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply(
      `📖 <b>Commands</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
        `/watch /unwatch /list /label\n` +
        `/portfolio /txhistory /price\n` +
        `/minsize /stats /menu`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('menu')
  async onMenu(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply(`🏠 <b>Main Menu</b>`, {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
    });
  }

  // ─── Commands ─────────────────────────────────────────────────────────────────

  @Command('watch')
  async onWatch(@Ctx() ctx: Context): Promise<void> {
    await this.trackUser(ctx);
    if (isGroup(ctx) && !(await isGroupAdmin(ctx))) {
      await ctx.reply(`🚫 Only group admins can add wallets to watch.`);
      return;
    }
    const address = this.extractArg(ctx);
    if (address) {
      await this.addWallet(ctx, address);
      return;
    }
    if (isGroup(ctx)) {
      await ctx.reply(`👛 Usage: <code>/watch &lt;solana_address&gt;</code>`, {
        parse_mode: 'HTML',
      });
      return;
    }
    pendingAction.set(ctx.chat.id, 'watch');
    await ctx.reply(
      `👛 <b>Add Wallet</b>\n\nPaste the Solana wallet address you want to watch:`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('unwatch')
  async onUnwatch(@Ctx() ctx: Context): Promise<void> {
    if (isGroup(ctx) && !(await isGroupAdmin(ctx))) {
      await ctx.reply(`🚫 Only group admins can remove wallets.`);
      return;
    }
    const address = this.extractArg(ctx);
    if (address) {
      await this.removeWallet(ctx, address);
      return;
    }
    if (isGroup(ctx)) {
      await ctx.reply(`� Usage: <code>/unwatch &lt;solana_address&gt;</code>`, {
        parse_mode: 'HTML',
      });
      return;
    }
    const wallets = await this.solanaService.getWatchedWallets(ctx.chat.id);
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
    await ctx.reply(
      `🗑 <b>Remove Wallet</b>\n\nPaste the address to remove:\n\n${list}`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('list')
  async onList(@Ctx() ctx: Context): Promise<void> {
    if (isGroup(ctx)) {
      const wallets = await this.solanaService.getWatchedWallets(ctx.chat.id);
      if (wallets.length === 0) {
        await ctx.reply(
          `📭 No wallets being watched in this group. Use /watch &lt;address&gt; to add one.`,
          { parse_mode: 'HTML' },
        );
        return;
      }
      const list = wallets
        .map((w) => {
          const short = `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
          const name = w.label ? ` — <b>${w.label}</b>` : '';
          const paused = w.paused ? ' ⏸' : '';
          return `• ${short}${name}${paused}\n  <code>${w.address}</code>`;
        })
        .join('\n\n');
      await ctx.reply(
        `👁 <b>Watched Wallets (${wallets.length})</b>\n━━━━━━━━━━━━━━━━━━━━\n${list}`,
        { parse_mode: 'HTML' },
      );
      return;
    }
    const { text, keyboard } = await this.buildWalletListContent(ctx.chat.id);
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }

  @Command('trending')
  async onTrending(@Ctx() ctx: Context): Promise<void> {
    const replyToId = (ctx.message as any)?.message_id;
    const tokens = await this.solanaService.getTrendingTokens(ctx.chat.id);
    const groupName = (ctx.chat as any)?.title ?? 'this group';
    const botUsername = process.env.BOT_USERNAME ?? '';

    if (tokens.length === 0) {
      await ctx.reply(
        `⚡ <b>Trending Tokens (1D)</b>\n└ ${groupName}\n\nNo tokens called in the past 24 hours.`,
        {
          parse_mode: 'HTML',
          reply_parameters: { message_id: replyToId },
        } as any,
      );
      return;
    }

    const total = tokens.reduce((s, t) => s + t.count, 0);

    const list = tokens
      .map((t, i) => {
        const label = t.symbol
          ? `$${t.symbol}`
          : `${t.mint.slice(0, 6)}...${t.mint.slice(-4)}`;
        const times = t.count > 1 ? ` \"` : '';
        const url = `https://t.me/${botUsername}?start=token_${t.mint}`;
        return `${i + 1}: <a href="${url}">${label}</a>${times}`;
      })
      .join('\n');

    await ctx.reply(
      `⚡ <b>Trending Tokens (1D)</b>\n└ ${groupName}\n\n${list}\n\nℹ️ In the past <b>1D</b> <b>${total}</b> token${total !== 1 ? 's have' : ' has'} been queried.`,
      {
        parse_mode: 'HTML',
        reply_parameters: { message_id: replyToId },
        // @ts-ignore
        disable_web_page_preview: true,
      } as any,
    );
  }

  @Command('label')
  async onLabel(@Ctx() ctx: Context): Promise<void> {
    const wallets = await this.solanaService.getWatchedWallets(ctx.chat.id);
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
    await ctx.reply(
      `🏷 <b>Label a Wallet</b>\n\nPaste the address you want to name:\n\n${list}`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('portfolio')
  async onPortfolio(@Ctx() ctx: Context): Promise<void> {
    const address = this.extractArg(ctx);
    if (address) {
      await this.showPortfolio(ctx, address);
      return;
    }
    pendingAction.set(ctx.chat.id, 'portfolio');
    await ctx.reply(
      `💼 <b>Portfolio Lookup</b>\n\nPaste the Solana wallet address to check:`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('pnl')
  async onPnl(@Ctx() ctx: Context): Promise<void> {
    const address = this.extractArg(ctx);
    if (address) {
      await this.showPnlAnalysis(ctx, address);
      return;
    }
    pendingAction.set(ctx.chat.id, 'pnl');
    await ctx.reply(
      `📊 <b>PnL Analysis</b>\n\nPaste the Solana wallet address to analyse:`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('backfill')
  async onBackfill(@Ctx() ctx: Context): Promise<void> {
    const address = this.extractArg(ctx);
    if (!address) {
      await ctx.reply(
        `🔄 <b>Backfill Historical Trades</b>\n\nUsage: <code>/backfill &lt;wallet_address&gt;</code>\n\nThis will scan the last 100 transactions and import them for PnL tracking.`,
        { parse_mode: 'HTML' },
      );
      return;
    }
    const chainErr = this.solanaService.chainErrorMessage(address);
    if (chainErr) {
      await ctx.reply(chainErr, { parse_mode: 'HTML' });
      return;
    }
    const loading = await ctx.reply(
      '🔄 Backfilling historical trades... This may take a minute.',
    );
    try {
      const result = await this.solanaService.backfillTrades(address, 100);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        result.success
          ? `✅ <b>Backfill Complete</b>\n\n${result.message}\n\nYou can now view full PnL history with <code>/pnl ${address}</code>`
          : `❌ <b>Backfill Failed</b>\n\n${result.message}`,
        { parse_mode: 'HTML' },
      );
    } catch (err) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        `❌ Failed to backfill trades. Please try again.`,
        { parse_mode: 'HTML' },
      );
    }
  }

  @Command('txhistory')
  async onTxHistory(@Ctx() ctx: Context): Promise<void> {
    const address = this.extractArg(ctx);
    if (address) {
      await this.showTxHistory(ctx, address);
      return;
    }
    pendingAction.set(ctx.chat.id, 'txhistory');
    await ctx.reply(
      `📜 <b>Transaction History</b>\n\nPaste the Solana wallet address:`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('price')
  async onPrice(@Ctx() ctx: Context): Promise<void> {
    const arg = this.extractArg(ctx);
    if (arg) {
      await this.showPrice(ctx, arg);
      return;
    }
    pendingAction.set(ctx.chat.id, 'price');
    await ctx.reply(
      `� <b>Token Price</b>\n\nPaste a token mint address or symbol:`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('stats')
  async onStats(@Ctx() ctx: Context): Promise<void> {
    await this.trackUser(ctx);
    const stats = await this.solanaService.getStats();
    await ctx.reply(stats, { parse_mode: 'HTML' });
  }

  @Command('minsize')
  async onMinSize(@Ctx() ctx: Context): Promise<void> {
    const arg = this.extractArg(ctx);
    if (arg) {
      await this.setMinSize(ctx, arg);
      return;
    }
    const current = await this.solanaService.getMinTradeSize(ctx.chat.id);
    pendingAction.set(ctx.chat.id, 'minsize');
    await ctx.reply(
      `⚙️ <b>Minimum Alert Size</b>\n\nCurrent: <b>${current > 0 ? `$${current}` : 'All trades'}</b>\n\nEnter a USD amount or <b>0</b> for all:`,
      { parse_mode: 'HTML' },
    );
  }

  // ─── Main Menu Callbacks ──────────────────────────────────────────────────────

  @Action('menu_main')
  async onMenuMain(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    await ctx.editMessageText(`🏠 <b>Main Menu</b>`, {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
    });
  }

  @Action('menu_watch')
  async onMenuWatch(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    pendingAction.set(ctx.chat.id, 'watch');
    await ctx.reply(
      `� <b>Add Wallet</b>\n\nPaste the Solana wallet address you want to watch:`,
      { parse_mode: 'HTML' },
    );
  }

  @Action('menu_list')
  async onMenuList(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const { text, keyboard } = await this.buildWalletListContent(ctx.chat.id);
    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
  }

  @Action('menu_portfolio')
  async onMenuPortfolio(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    pendingAction.set(ctx.chat.id, 'portfolio');
    await ctx.reply(
      `💼 <b>Portfolio Lookup</b>\n\nPaste the Solana wallet address to check:`,
      { parse_mode: 'HTML' },
    );
  }

  @Action('menu_txhistory')
  async onMenuTxHistory(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    pendingAction.set(ctx.chat.id, 'txhistory');
    await ctx.reply(
      `📜 <b>Transaction History</b>\n\nPaste the Solana wallet address:`,
      { parse_mode: 'HTML' },
    );
  }

  @Action('menu_price')
  async onMenuPrice(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    pendingAction.set(ctx.chat.id, 'price');
    await ctx.reply(
      `💲 <b>Token Price</b>\n\nPaste a token mint address or symbol:`,
      { parse_mode: 'HTML' },
    );
  }

  @Action('menu_minsize')
  async onMenuMinSize(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const current = await this.solanaService.getMinTradeSize(ctx.chat.id);
    pendingAction.set(ctx.chat.id, 'minsize');
    await ctx.reply(
      `⚙️ <b>Minimum Alert Size</b>\n\nCurrent: <b>${current > 0 ? `$${current}` : 'All trades'}</b>\n\nEnter a USD amount or <b>0</b> for all:`,
      { parse_mode: 'HTML' },
    );
  }

  @Action('menu_stats')
  async onMenuStats(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const stats = await this.solanaService.getStats();
    await ctx.reply(stats, { parse_mode: 'HTML' });
  }

  @Action('menu_help')
  async onMenuHelp(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    await ctx.reply(
      `📖 <b>Commands</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
        `/watch /unwatch /list /label\n/portfolio /txhistory /price\n/minsize /stats /menu`,
      { parse_mode: 'HTML' },
    );
  }

  // ─── Wallet Panel Callbacks ───────────────────────────────────────────────────

  @Action(/^wallet_open:(.+)$/)
  async onWalletOpen(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const address = (ctx as any).match[1];
    const label = await this.solanaService.getWalletLabel(ctx.chat.id, address);
    const paused = await this.solanaService.isWalletPaused(
      ctx.chat.id,
      address,
    );
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    const name = label ? `🏷 <b>${label}</b>\n` : '';
    const pausedLine = paused ? `⏸ <i>Notifications paused</i>\n` : '';
    await ctx.editMessageText(
      `${name}${pausedLine}👛 <a href="https://solscan.io/account/${address}">${short}</a>\n<code>${address}</code>`,
      { parse_mode: 'HTML', reply_markup: walletKeyboard(address, paused) },
    );
  }

  @Action(/^wallet_portfolio:(.+)$/)
  async onWalletPortfolio(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    await this.showPortfolio(ctx, (ctx as any).match[1]);
  }

  @Action(/^wallet_txhistory:(.+)$/)
  async onWalletTxHistory(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    await this.showTxHistory(ctx, (ctx as any).match[1]);
  }

  @Action(/^wallet_pnl:(.+)$/)
  async onWalletPnl(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    await this.showPnlAnalysis(ctx, (ctx as any).match[1]);
  }

  @Action(/^wallet_backfill:(.+)$/)
  async onWalletBackfill(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const address = (ctx as any).match[1];
    const loading = await ctx.reply(
      '🔄 Backfilling historical trades... This may take a minute.',
    );
    try {
      const result = await this.solanaService.backfillTrades(address, 100);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        result.success
          ? `✅ <b>Backfill Complete</b>\n\n${result.message}\n\nYou can now view full PnL history with /pnl`
          : `❌ <b>Backfill Failed</b>\n\n${result.message}`,
        { parse_mode: 'HTML' },
      );
    } catch (err) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        `❌ Failed to backfill trades. Please try again.`,
        { parse_mode: 'HTML' },
      );
    }
  }

  @Action(/^wallet_unwatch:(.+)$/)
  async onWalletUnwatch(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    await this.removeWallet(ctx, (ctx as any).match[1]);
  }

  @Action(/^wallet_pause:(.+)$/)
  async onWalletPause(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const address = (ctx as any).match[1];
    await this.solanaService.pauseWallet(ctx.chat.id, address);
    const label = await this.solanaService.getWalletLabel(ctx.chat.id, address);
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    const name = label ? `🏷 <b>${label}</b>\n` : '';
    await ctx.editMessageText(
      `${name}⏸ <i>Notifications paused</i>\n👛 <a href="https://solscan.io/account/${address}">${short}</a>\n<code>${address}</code>`,
      { parse_mode: 'HTML', reply_markup: walletKeyboard(address, true) },
    );
  }

  @Action(/^wallet_unpause:(.+)$/)
  async onWalletUnpause(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const address = (ctx as any).match[1];
    await this.solanaService.unpauseWallet(ctx.chat.id, address);
    const label = await this.solanaService.getWalletLabel(ctx.chat.id, address);
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    const name = label ? `🏷 <b>${label}</b>\n` : '';
    await ctx.editMessageText(
      `${name}👛 <a href="https://solscan.io/account/${address}">${short}</a>\n<code>${address}</code>`,
      { parse_mode: 'HTML', reply_markup: walletKeyboard(address, false) },
    );
  }

  @Action(/^wallet_minsize:(.+)$/)
  async onWalletMinSize(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const address = (ctx as any).match[1];
    const current = await this.solanaService.getWalletMinTradeSize(
      ctx.chat.id,
      address,
    );
    const global = await this.solanaService.getMinTradeSize(ctx.chat.id);
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    pendingWalletMinsizeAddress.set(ctx.chat.id, address);
    pendingAction.set(ctx.chat.id, 'wallet_minsize');
    await ctx.reply(
      `⚙️ <b>Min Trade Size for ${short}</b>\n\n` +
        `Global setting: <b>${global > 0 ? `$${global}` : 'All trades'}</b>\n` +
        `Wallet setting: <b>${current !== null ? `$${current}` : 'Using global'}</b>\n\n` +
        `Enter a USD amount, <b>0</b> for all trades, or <b>clear</b> to use global:`,
      { parse_mode: 'HTML' },
    );
  }

  @Action(/^wallet_label:(.+)$/)
  async onWalletLabel(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const address = (ctx as any).match[1];
    pendingLabelAddress.set(ctx.chat.id, address);
    pendingAction.set(ctx.chat.id, 'label_name');
    const existing = await this.solanaService.getWalletLabel(
      ctx.chat.id,
      address,
    );
    const current = existing ? ` (current: <b>${existing}</b>)` : '';
    await ctx.reply(
      `🏷 Enter a name for this wallet${current}:\n<code>${address}</code>`,
      { parse_mode: 'HTML' },
    );
  }

  @Action(/^wallet_tags:(.+)$/)
  async onWalletTags(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const address = (ctx as any).match[1];
    const tags = await this.solanaService.getWalletTags(ctx.chat.id, address);
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    const tagList =
      tags.length > 0 ? tags.map((t) => `• ${t}`).join('\n') : 'No tags yet.';
    await ctx.reply(
      `🏴 <b>Tags for ${short}</b>\n\n${tagList}\n\n` +
        `To add: <code>/tag ${address} tagname</code>\n` +
        `To remove: <code>/untag ${address} tagname</code>`,
      { parse_mode: 'HTML' },
    );
  }

  // ─── Text Handler ─────────────────────────────────────────────────────────────

  @On('text')
  async onText(
    @Ctx() ctx: Context,
    @Message('text') text: string,
  ): Promise<void> {
    if (text.startsWith('/')) return;
    const chatId = ctx.chat.id;
    this.trackUser(ctx);

    // Handle persistent bottom keyboard buttons
    if (text === '➕ Track Wallet') {
      pendingAction.set(chatId, 'watch');
      await ctx.reply(
        `👛 <b>Add Wallet</b>\n\nPaste the Solana wallet address you want to watch:`,
        { parse_mode: 'HTML' },
      );
      return;
    }
    if (text === '📋 List Wallets') {
      const { text: listText, keyboard } =
        await this.buildWalletListContent(chatId);
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
    if (!action) {
      // Auto-detect pasted Solana address (base58, 32-44 chars, no spaces)
      const trimmed = text.trim();
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
        // Skip if it's a watched wallet address — not a token
        const watched = await this.solanaService.getWatchedWallets(chatId);
        if (watched.some((w) => w.address === trimmed)) return;
        await this.showTokenInfo(ctx, trimmed);
        return;
      }
      return;
    }
    pendingAction.delete(chatId);
    const input = text.trim();

    if (action === 'watch') await this.addWallet(ctx, input);
    else if (action === 'unwatch') await this.removeWallet(ctx, input);
    else if (action === 'portfolio') await this.showPortfolio(ctx, input);
    else if (action === 'pnl') await this.showPnlAnalysis(ctx, input);
    else if (action === 'txhistory') await this.showTxHistory(ctx, input);
    else if (action === 'price') await this.showPrice(ctx, input);
    else if (action === 'minsize') await this.setMinSize(ctx, input);
    else if (action === 'label_address') {
      const chainErr = this.solanaService.chainErrorMessage(input);
      if (chainErr) {
        await ctx.reply(chainErr, { parse_mode: 'HTML' });
        return;
      }
      const wallets = await this.solanaService.getWatchedWallets(chatId);
      const found = wallets.find((w) => w.address === input);
      if (!found) {
        await ctx.reply(`❌ That address isn't in your watch list.`);
        return;
      }
      pendingLabelAddress.set(chatId, input);
      pendingAction.set(chatId, 'label_name');
      const current = found.label ? ` (current: <b>${found.label}</b>)` : '';
      await ctx.reply(
        `🏷 Enter a name for this wallet${current}:\n<code>${input}</code>`,
        { parse_mode: 'HTML' },
      );
    } else if (action === 'label_name') {
      const address = pendingLabelAddress.get(chatId);
      pendingLabelAddress.delete(chatId);
      if (!address) {
        await ctx.reply('❌ Something went wrong. Try /label again.');
        return;
      }
      const success = await this.solanaService.setWalletLabel(
        chatId,
        address,
        input,
      );
      if (!success) {
        await ctx.reply('❌ Could not set label. Try /label again.');
        return;
      }
      const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
      await ctx.reply(
        `✅ <b>Label saved</b>\n\n👛 ${short} is now called <b>${input}</b>`,
        { parse_mode: 'HTML' },
      );
    } else if (action === 'wallet_minsize') {
      const address = pendingWalletMinsizeAddress.get(chatId);
      pendingWalletMinsizeAddress.delete(chatId);
      if (!address) {
        await ctx.reply('❌ Something went wrong. Try again.');
        return;
      }
      const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
      if (input.toLowerCase() === 'clear') {
        await this.solanaService.setWalletMinTradeSize(chatId, address, null);
        await ctx.reply(
          `✅ <b>Wallet min size cleared</b>\n\n${short} will now use your global setting.`,
          { parse_mode: 'HTML' },
        );
      } else {
        const value = parseFloat(input);
        if (isNaN(value) || value < 0) {
          await ctx.reply(
            `❌ Enter a number like <code>100</code>, <code>0</code> for all, or <code>clear</code>.`,
            { parse_mode: 'HTML' },
          );
          return;
        }
        await this.solanaService.setWalletMinTradeSize(chatId, address, value);
        await ctx.reply(
          value === 0
            ? `✅ <b>${short}</b> will now alert on all trades.`
            : `✅ <b>${short}</b> min alert size set to <b>$${value}</b>.`,
          { parse_mode: 'HTML' },
        );
      }
    }
  }

  // ─── Private Actions ──────────────────────────────────────────────────────────

  private async addWallet(ctx: Context, address: string): Promise<void> {
    try {
      const chainErr = this.solanaService.chainErrorMessage(address);
      if (chainErr) {
        await ctx.reply(chainErr, { parse_mode: 'HTML' });
        return;
      }
      const success = await this.solanaService.watchWallet(
        address,
        ctx.chat.id,
      );
      if (!success) {
        await ctx.reply(
          `❌ <b>Invalid address</b>\n\nNot a valid Solana wallet.`,
          { parse_mode: 'HTML' },
        );
        return;
      }
      const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
      if (isGroup(ctx)) {
        await ctx.reply(
          `✅ <b>Wallet Added</b>\n` +
            `👛 <code>${address}</code>\n\n` +
            `This group will now receive alerts for every trade.\n` +
            `Use <code>/unwatch ${address}</code> to stop.`,
          { parse_mode: 'HTML' },
        );
      } else {
        await ctx.reply(
          `✅ <b>Wallet Added</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `👛 <a href="https://solscan.io/account/${address}">${short}</a>\n` +
            `<code>${address}</code>\n\n` +
            `You'll be notified on every buy and sell.\n💡 Use /label to give this wallet a name.`,
          { parse_mode: 'HTML', reply_markup: walletKeyboard(address) },
        );
      }
    } catch {
      await ctx.reply(`❌ Something went wrong. Please try again.`);
    }
  }

  private async removeWallet(ctx: Context, address: string): Promise<void> {
    const success = await this.solanaService.unwatchWallet(
      address,
      ctx.chat.id,
    );
    if (!success) {
      await ctx.reply(`❌ That wallet isn't in your watch list.`);
      return;
    }
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    await ctx.reply(
      `🗑 <b>Wallet Removed</b>\n\n<code>${short}</code> is no longer being watched.`,
      { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() },
    );
  }

  private async showPortfolio(ctx: Context, address: string): Promise<void> {
    const chainErr = this.solanaService.chainErrorMessage(address);
    if (chainErr) {
      await ctx.reply(chainErr, { parse_mode: 'HTML' });
      return;
    }
    const loading = await ctx.reply('⏳ Fetching portfolio data...');
    try {
      const result = await this.solanaService.getPortfolio(address);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        result,
        {
          parse_mode: 'HTML',
          reply_markup: walletKeyboard(address),
        },
      );
    } catch {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        `❌ Failed to fetch portfolio. Please try again.`,
        { parse_mode: 'HTML' },
      );
    }
  }

  private async showTxHistory(ctx: Context, address: string): Promise<void> {
    const chainErr = this.solanaService.chainErrorMessage(address);
    if (chainErr) {
      await ctx.reply(chainErr, { parse_mode: 'HTML' });
      return;
    }
    const loading = await ctx.reply('⏳ Loading transaction history...');
    try {
      const result = await this.solanaService.getTxHistory(address);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        result,
        {
          parse_mode: 'HTML',
          reply_markup: walletKeyboard(address),
        },
      );
    } catch {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        `❌ Failed to load history. Please try again.`,
        { parse_mode: 'HTML' },
      );
    }
  }

  private async showPnlAnalysis(ctx: Context, address: string): Promise<void> {
    const chainErr = this.solanaService.chainErrorMessage(address);
    if (chainErr) {
      await ctx.reply(chainErr, { parse_mode: 'HTML' });
      return;
    }
    const loading = await ctx.reply('⏳ Calculating PnL...');
    try {
      const result = await this.solanaService.getPnlAnalysis(address);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        result,
        { parse_mode: 'HTML', reply_markup: walletKeyboard(address) },
      );
    } catch {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        `❌ Failed to load PnL analysis. Please try again.`,
        { parse_mode: 'HTML' },
      );
    }
  }

  private async showPrice(ctx: Context, mintOrSymbol: string): Promise<void> {
    const loading = await ctx.reply('⏳ Fetching price...');
    try {
      const result = await this.solanaService.getTokenPrice(mintOrSymbol);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        result,
        { parse_mode: 'HTML' },
      );
    } catch {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        `❌ Could not find price for <code>${mintOrSymbol}</code>.`,
        { parse_mode: 'HTML' },
      );
    }
  }

  private async setMinSize(ctx: Context, input: string): Promise<void> {
    const value = parseFloat(input);
    if (isNaN(value) || value < 0) {
      await ctx.reply(
        `❌ Enter a number like <code>100</code> or <code>0</code> to disable.`,
        { parse_mode: 'HTML' },
      );
      return;
    }
    await this.solanaService.setMinTradeSize(ctx.chat.id, value);
    await ctx.reply(
      value === 0
        ? `✅ <b>Filter removed</b> — you'll receive all trade alerts.`
        : `✅ <b>Min alert size: $${value}</b>\n\nOnly trades above this value will notify you.`,
      { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() },
    );
  }

  private async showTokenInfo(ctx: Context, mint: string): Promise<void> {
    const replyToId = (ctx.message as any)?.message_id;
    const loading = await ctx.reply('🔍 Fetching token info...');
    try {
      const { text, imageUrl, symbol, name } =
        await this.solanaService.getTokenInfo(mint);
      const keyboard = {
        inline_keyboard: [
          [
            { text: 'Chart', url: `https://dexscreener.com/solana/${mint}` },
            {
              text: 'Birdeye',
              url: `https://birdeye.so/token/${mint}?chain=solana`,
            },
            { text: 'Solscan', url: `https://solscan.io/token/${mint}` },
          ],
        ],
      };
      await ctx.telegram
        .deleteMessage(ctx.chat.id, (loading as any).message_id)
        .catch(() => {});

      // Record call in groups for trending
      if (isGroup(ctx)) {
        this.solanaService
          .recordGroupTokenCall(ctx.chat.id, mint, symbol, name)
          .catch(() => {});
      }

      if (imageUrl) {
        await ctx.replyWithPhoto(imageUrl, {
          caption: text,
          parse_mode: 'HTML',
          reply_markup: keyboard,
          reply_parameters: { message_id: replyToId },
        } as any);
      } else {
        await ctx.reply(text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
          reply_parameters: { message_id: replyToId },
        } as any);
      }
    } catch {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        (loading as any).message_id,
        undefined,
        `❌ Could not fetch token info. Make sure it's a valid Solana token address.`,
        { parse_mode: 'HTML' },
      );
    }
  }
}
