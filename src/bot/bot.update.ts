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
import { InlineKeyboardMarkup } from 'telegraf/types';
import { SolanaService } from '../solana/solana.service';

type PendingAction =
  | 'watch'
  | 'unwatch'
  | 'portfolio'
  | 'txhistory'
  | 'price'
  | 'minsize'
  | 'label_address'
  | 'label_name';

const pendingAction = new Map<number, PendingAction>();
const pendingLabelAddress = new Map<number, string>();

// ─── Keyboard Builders ────────────────────────────────────────────────────────

function mainMenuKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '👁 Watch Wallet', callback_data: 'menu_watch' },
        { text: '📋 My List', callback_data: 'menu_list' },
      ],
      [
        { text: '💼 Portfolio', callback_data: 'menu_portfolio' },
        { text: '� TX History', callback_data: 'menu_txhistory' },
      ],
      [
        { text: '💲 Token Price', callback_data: 'menu_price' },
        { text: '⚙️ Min Size', callback_data: 'menu_minsize' },
      ],
      [
        { text: '� Stats', callback_data: 'menu_stats' },
        { text: '❓ Help', callback_data: 'menu_help' },
      ],
    ],
  };
}

function walletKeyboard(address: string): InlineKeyboardMarkup {
  const enc = encodeURIComponent(address);
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
          text: '📈 DexScreener',
          url: `https://dexscreener.com/solana/${address}`,
        },
      ],
      [{ text: '🔙 Main Menu', callback_data: 'menu_main' }],
    ],
  };
}

function tradeAlertKeyboard(
  address: string,
  tokenMint: string,
): InlineKeyboardMarkup {
  const buttons: any[][] = [
    [
      { text: '💼 Portfolio', callback_data: `wallet_portfolio:${address}` },
      { text: '📜 TX History', callback_data: `wallet_txhistory:${address}` },
    ],
  ];
  if (tokenMint) {
    buttons.push([
      { text: '📈 Chart', url: `https://dexscreener.com/solana/${tokenMint}` },
      { text: '🪙 Token', url: `https://solscan.io/token/${tokenMint}` },
    ]);
  }
  buttons.push([
    { text: '👛 Wallet', url: `https://solscan.io/account/${address}` },
  ]);
  return { inline_keyboard: buttons };
}

@Update()
export class BotUpdate {
  constructor(private solanaService: SolanaService) {}

  // ─── Start ───────────────────────────────────────────────────────────────────

  @Start()
  async onStart(@Ctx() ctx: Context): Promise<void> {
    this.trackUser(ctx);
    await ctx.reply(
      `🚀 <b>Sol Wallet Watcher</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Real-time Solana wallet tracker.\n` +
        `Get instant alerts on buys & sells.\n\n` +
        `Choose an option below 👇`,
      { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() },
    );
  }

  @Command('help')
  async onHelp(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply(
      `📖 <b>Commands</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `/watch — add a wallet to watch\n` +
        `/unwatch — remove a wallet\n` +
        `/list — show all watched wallets\n` +
        `/label — name a wallet\n` +
        `/portfolio — token breakdown & value\n` +
        `/txhistory — last 10 transactions\n` +
        `/price — check any token price\n` +
        `/minsize — set minimum trade alert size\n` +
        `/stats — bot usage stats\n` +
        `/menu — show main menu`,
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

  // ─── Commands ────────────────────────────────────────────────────────────────

  @Command('watch')
  async onWatch(@Ctx() ctx: Context): Promise<void> {
    this.trackUser(ctx);
    const address = this.extractArg(ctx);
    if (address) {
      await this.addWallet(ctx, address);
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
    await ctx.reply(
      `� <b>Remove Wallet</b>\n\nPaste the address to remove:\n\n${list}`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('list')
  async onList(@Ctx() ctx: Context): Promise<void> {
    await this.showWalletList(ctx);
  }

  @Command('label')
  async onLabel(@Ctx() ctx: Context): Promise<void> {
    await this.startLabelFlow(ctx);
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
      `💲 <b>Token Price</b>\n\nPaste a token mint address or symbol (e.g. <code>SOL</code>, <code>BONK</code>):`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('stats')
  async onStats(@Ctx() ctx: Context): Promise<void> {
    this.trackUser(ctx);
    await ctx.reply(this.solanaService.getStats(), { parse_mode: 'HTML' });
  }

  @Command('minsize')
  async onMinSize(@Ctx() ctx: Context): Promise<void> {
    const arg = this.extractArg(ctx);
    if (arg) {
      await this.setMinSize(ctx, arg);
      return;
    }
    const current = this.solanaService.getMinTradeSize(ctx.chat.id);
    pendingAction.set(ctx.chat.id, 'minsize');
    await ctx.reply(
      `⚙️ <b>Minimum Alert Size</b>\n\n` +
        `Current: <b>${current > 0 ? `$${current}` : 'All trades (no filter)'}</b>\n\n` +
        `Enter a USD amount. Send <b>0</b> to receive all alerts.`,
      { parse_mode: 'HTML' },
    );
  }

  // ─── Inline Button Callbacks ─────────────────────────────────────────────────

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
    await this.showWalletList(ctx);
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
    const current = this.solanaService.getMinTradeSize(ctx.chat.id);
    pendingAction.set(ctx.chat.id, 'minsize');
    await ctx.reply(
      `⚙️ <b>Minimum Alert Size</b>\n\nCurrent: <b>${current > 0 ? `$${current}` : 'All trades'}</b>\n\nEnter a USD amount or <b>0</b> for all:`,
      { parse_mode: 'HTML' },
    );
  }

  @Action('menu_stats')
  async onMenuStats(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    await ctx.reply(this.solanaService.getStats(), { parse_mode: 'HTML' });
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

  // Wallet panel button callbacks
  @Action(/^wallet_portfolio:(.+)$/)
  async onWalletPortfolio(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const address = (ctx as any).match[1];
    await this.showPortfolio(ctx, address);
  }

  @Action(/^wallet_txhistory:(.+)$/)
  async onWalletTxHistory(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const address = (ctx as any).match[1];
    await this.showTxHistory(ctx, address);
  }

  @Action(/^wallet_unwatch:(.+)$/)
  async onWalletUnwatch(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const address = (ctx as any).match[1];
    await this.removeWallet(ctx, address);
  }

  @Action(/^wallet_label:(.+)$/)
  async onWalletLabel(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery();
    const address = (ctx as any).match[1];
    pendingLabelAddress.set(ctx.chat.id, address);
    pendingAction.set(ctx.chat.id, 'label_name');
    const label = this.solanaService.getWalletLabel(ctx.chat.id, address);
    const current = label ? ` (current: <b>${label}</b>)` : '';
    await ctx.reply(
      `🏷 Enter a name for this wallet${current}:\n<code>${address}</code>`,
      { parse_mode: 'HTML' },
    );
  }

  // ─── Text Handler ────────────────────────────────────────────────────────────

  @On('text')
  async onText(
    @Ctx() ctx: Context,
    @Message('text') text: string,
  ): Promise<void> {
    if (text.startsWith('/')) return;
    const chatId = ctx.chat.id;
    this.trackUser(ctx);
    const action = pendingAction.get(chatId);
    if (!action) return;
    pendingAction.delete(chatId);
    const input = text.trim();

    if (action === 'watch') await this.addWallet(ctx, input);
    else if (action === 'unwatch') await this.removeWallet(ctx, input);
    else if (action === 'portfolio') await this.showPortfolio(ctx, input);
    else if (action === 'txhistory') await this.showTxHistory(ctx, input);
    else if (action === 'price') await this.showPrice(ctx, input);
    else if (action === 'minsize') await this.setMinSize(ctx, input);
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
      const success = this.solanaService.setWalletLabel(chatId, address, input);
      if (!success) {
        await ctx.reply('❌ Could not set label. Try /label again.');
        return;
      }
      const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
      await ctx.reply(
        `✅ <b>Label saved</b>\n\n👛 ${short} is now called <b>${input}</b>`,
        { parse_mode: 'HTML' },
      );
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private extractArg(ctx: Context): string | null {
    const text = (ctx.message as any)?.text || '';
    const parts = text.trim().split(/\s+/);
    return parts[1] || null;
  }

  private trackUser(ctx: Context): void {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    this.solanaService.trackUser(chatId, (ctx.from as any)?.username || '');
  }

  private async showWalletList(ctx: Context): Promise<void> {
    const wallets = this.solanaService.getWatchedWallets(ctx.chat.id);
    if (wallets.length === 0) {
      await ctx.reply(
        `📭 <b>No wallets watched yet</b>\n\nUse /watch to add one.`,
        {
          parse_mode: 'HTML',
          reply_markup: mainMenuKeyboard(),
        },
      );
      return;
    }

    const min = this.solanaService.getMinTradeSize(ctx.chat.id);
    const filterLine = min > 0 ? `\n⚙️ Min alert: <b>$${min}</b>` : '';

    // Show each wallet as its own message with action buttons
    await ctx.reply(
      `👁 <b>Watched Wallets</b> (${wallets.length})${filterLine}\n━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'HTML' },
    );

    for (const w of wallets) {
      const short = `${w.address.slice(0, 6)}...${w.address.slice(-4)}`;
      const name = w.label ? `🏷 <b>${w.label}</b>\n` : '';
      await ctx.reply(
        `${name}👛 <a href="https://solscan.io/account/${w.address}">${short}</a>\n<code>${w.address}</code>`,
        { parse_mode: 'HTML', reply_markup: walletKeyboard(w.address) },
      );
    }
  }

  private async startLabelFlow(ctx: Context): Promise<void> {
    const wallets = this.solanaService.getWatchedWallets(ctx.chat.id);
    if (wallets.length === 0) {
      await ctx.reply(
        `📭 You have no wallets to label.\nUse /watch to add one first.`,
      );
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

  async addWallet(ctx: Context, address: string): Promise<void> {
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
      await ctx.reply(
        `✅ <b>Wallet Added</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
          `👛 <a href="https://solscan.io/account/${address}">${short}</a>\n` +
          `<code>${address}</code>\n\n` +
          `You'll be notified on every buy and sell.`,
        { parse_mode: 'HTML', reply_markup: walletKeyboard(address) },
      );
    } catch {
      await ctx.reply(`❌ Something went wrong. Please try again.`);
    }
  }

  private async removeWallet(ctx: Context, address: string): Promise<void> {
    const success = this.solanaService.unwatchWallet(address, ctx.chat.id);
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
    this.solanaService.setMinTradeSize(ctx.chat.id, value);
    await ctx.reply(
      value === 0
        ? `✅ <b>Filter removed</b> — you'll receive all trade alerts.`
        : `✅ <b>Min alert size: $${value}</b>\n\nOnly trades above this value will notify you.`,
      { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() },
    );
  }

  // Called from SolanaService to send trade alerts with buttons
  getTradeAlertKeyboard(
    address: string,
    tokenMint: string,
  ): InlineKeyboardMarkup {
    return tradeAlertKeyboard(address, tokenMint);
  }
}
