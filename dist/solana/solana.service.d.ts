import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';
export declare class SolanaService implements OnModuleInit, OnModuleDestroy {
    private config;
    private bot;
    private readonly logger;
    private connection;
    private apiKey;
    private watchedWallets;
    constructor(config: ConfigService, bot: Telegraf);
    onModuleInit(): void;
    onModuleDestroy(): void;
    validateWallet(address: string): Promise<'valid' | 'invalid_address' | 'not_wallet'>;
    watchWallet(address: string, chatId: number | null): Promise<boolean>;
    unwatchWallet(address: string, chatId: number): boolean;
    getWatchedWallets(chatId: number): {
        address: string;
        label: string;
    }[];
    setWalletLabel(chatId: number, address: string, label: string): boolean;
    getWalletLabel(chatId: number, address: string): string;
    detectChain(address: string): 'solana' | 'ethereum' | 'bitcoin' | 'tron' | 'bnb' | 'unknown';
    chainErrorMessage(address: string): string | null;
    setMinTradeSize(chatId: number, usd: number): void;
    getMinTradeSize(chatId: number): number;
    trackUser(chatId: number, username: string): void;
    getStats(): string;
    getPortfolio(address: string): Promise<string>;
    getTxHistory(address: string): Promise<string>;
    getTokenPrice(mintOrSymbol: string): Promise<string>;
    private handleTransaction;
    private fetchTokenMeta;
    private detectAction;
    private formatTradeMessage;
    private bar;
}
