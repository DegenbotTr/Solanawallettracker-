import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
export declare class SolanaService implements OnModuleInit, OnModuleDestroy {
    private config;
    private prisma;
    private bot;
    private readonly logger;
    private connection;
    private apiKey;
    private watchedWallets;
    constructor(config: ConfigService, prisma: PrismaService, bot: Telegraf);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): void;
    private initWalletSubscription;
    validateWallet(address: string): Promise<'valid' | 'invalid_address' | 'not_wallet'>;
    watchWallet(address: string, chatId: number | null): Promise<boolean>;
    unwatchWallet(address: string, chatId: number): Promise<boolean>;
    getWatchedWallets(chatId: number): Promise<{
        address: string;
        label: string;
    }[]>;
    setWalletLabel(chatId: number, address: string, label: string): Promise<boolean>;
    getWalletLabel(chatId: number, address: string): Promise<string>;
    addWalletTag(chatId: number, address: string, tag: string): Promise<boolean>;
    removeWalletTag(chatId: number, address: string, tag: string): Promise<boolean>;
    getWalletTags(chatId: number, address: string): Promise<string[]>;
    getWalletsByTag(chatId: number, tag: string): Promise<{
        address: string;
        label: string;
    }[]>;
    getAllTags(chatId: number): Promise<string[]>;
    detectChain(address: string): 'solana' | 'ethereum' | 'bitcoin' | 'tron' | 'bnb' | 'unknown';
    chainErrorMessage(address: string): string | null;
    setMinTradeSize(chatId: number, usd: number): Promise<void>;
    getMinTradeSize(chatId: number): Promise<number>;
    trackUser(chatId: number, username: string): Promise<void>;
    getStats(): Promise<string>;
    getPortfolio(address: string): Promise<string>;
    getTxHistory(address: string): Promise<string>;
    getTokenPrice(mintOrSymbol: string): Promise<string>;
    private handleTransaction;
    private fetchTokenMeta;
    private detectAction;
    private formatTradeMessage;
    backfillTrades(address: string, limit: number): Promise<{
        success: boolean;
        message: string;
    }>;
    getPnlAnalysis(address: string): Promise<string>;
    private bar;
}
