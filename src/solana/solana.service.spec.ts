import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SolanaService } from './solana.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SolanaService', () => {
    let service: SolanaService;
    let configService: any;
    let prismaService: any;
    let mockBot: any;

    beforeEach(async () => {
        // Mock ConfigService
        configService = {
            get: jest.fn((key: string, defaultValue?: any) => {
                const config: Record<string, any> = {
                    HELIUS_API_KEY: 'test-api-key',
                    WATCHED_WALLETS: '',
                };
                return config[key] ?? defaultValue;
            }),
        };

        // Mock PrismaService with jest.fn() for all methods
        prismaService = {
            wallet: {
                findMany: jest.fn(),
                upsert: jest.fn(),
                count: jest.fn(),
            },
            user: {
                upsert: jest.fn(),
                findUnique: jest.fn(),
                count: jest.fn(),
            },
            watchedWallet: {
                findMany: jest.fn(),
                findUnique: jest.fn(),
                upsert: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                count: jest.fn(),
                groupBy: jest.fn(),
            },
            trade: {
                findMany: jest.fn(),
                upsert: jest.fn(),
            },
        };

        // Mock Bot
        mockBot = {
            telegram: {
                sendMessage: jest.fn().mockResolvedValue({}),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SolanaService,
                { provide: ConfigService, useValue: configService },
                { provide: PrismaService, useValue: prismaService },
                { provide: 'DEFAULT_BOT_NAME', useValue: mockBot },
            ],
        }).compile();

        service = module.get<SolanaService>(SolanaService);
    });

    describe('Module Initialization', () => {
        it('should initialize on module init', async () => {
            prismaService.wallet.findMany.mockResolvedValue([]);

            await service.onModuleInit();

            expect(configService.get).toHaveBeenCalledWith('HELIUS_API_KEY');
            expect(prismaService.wallet.findMany).toHaveBeenCalled();
        });

        it('should cleanup on module destroy', () => {
            service.onModuleDestroy();
            // Should not throw
            expect(true).toBe(true);
        });
    });

    describe('Wallet Validation', () => {
        it('should validate a valid Solana address', async () => {
            const result = await service.validateWallet(
                'EizqmoCSovbTzuSnmxkdaJwLBBZgyB2GyjN3m3uJWXpZ',
            );

            expect(result).toBe('valid');
        });

        it('should reject invalid address format', async () => {
            const result = await service.validateWallet('invalid-address');

            expect(result).toBe('invalid_address');
        });
    });

    describe('Watch Wallet', () => {
        it('should reject invalid address', async () => {
            const result = await service.watchWallet('invalid', 12345);

            expect(result).toBe(false);
        });
    });

    describe('Unwatch Wallet', () => {
        it('should remove wallet from watch list', async () => {
            prismaService.watchedWallet.delete.mockResolvedValue({});
            prismaService.watchedWallet.count.mockResolvedValue(0);

            const result = await service.unwatchWallet(
                '11111111111111111111111111111111',
                12345,
            );

            expect(result).toBe(true);
            expect(prismaService.watchedWallet.delete).toHaveBeenCalled();
        });

        it('should handle wallet not found', async () => {
            prismaService.watchedWallet.delete.mockRejectedValue(
                new Error('Not found'),
            );

            const result = await service.unwatchWallet(
                '11111111111111111111111111111111',
                12345,
            );

            expect(result).toBe(false);
        });
    });

    describe('Get Watched Wallets', () => {
        it('should return list of watched wallets', async () => {
            prismaService.watchedWallet.findMany.mockResolvedValue([
                { walletAddress: '11111111111111111111111111111111', label: 'Wallet 1' },
                { walletAddress: '22222222222222222222222222222222', label: null },
            ]);

            const result = await service.getWatchedWallets(12345);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                address: '11111111111111111111111111111111',
                label: 'Wallet 1',
            });
        });

        it('should return empty list when no wallets', async () => {
            prismaService.watchedWallet.findMany.mockResolvedValue([]);

            const result = await service.getWatchedWallets(12345);

            expect(result).toEqual([]);
        });
    });

    describe('Wallet Labels', () => {
        it('should set wallet label', async () => {
            prismaService.watchedWallet.update.mockResolvedValue({});

            const result = await service.setWalletLabel(
                12345,
                '11111111111111111111111111111111',
                'My Wallet',
            );

            expect(result).toBe(true);
            expect(prismaService.watchedWallet.update).toHaveBeenCalled();
        });

        it('should handle label update error', async () => {
            prismaService.watchedWallet.update.mockRejectedValue(
                new Error('Not found'),
            );

            const result = await service.setWalletLabel(
                12345,
                '11111111111111111111111111111111',
                'My Wallet',
            );

            expect(result).toBe(false);
        });

        it('should get wallet label', async () => {
            prismaService.watchedWallet.findUnique.mockResolvedValue({
                label: 'My Wallet',
            });

            const result = await service.getWalletLabel(
                12345,
                '11111111111111111111111111111111',
            );

            expect(result).toBe('My Wallet');
        });

        it('should return empty string when no label', async () => {
            prismaService.watchedWallet.findUnique.mockResolvedValue(null);

            const result = await service.getWalletLabel(
                12345,
                '11111111111111111111111111111111',
            );

            expect(result).toBe('');
        });
    });

    describe('Wallet Tags', () => {
        it('should add tag to wallet', async () => {
            prismaService.watchedWallet.findUnique.mockResolvedValue({
                tags: ['existing'],
            });
            prismaService.watchedWallet.update.mockResolvedValue({});

            const result = await service.addWalletTag(
                12345,
                '11111111111111111111111111111111',
                'NewTag',
            );

            expect(result).toBe(true);
        });

        it('should remove tag from wallet', async () => {
            prismaService.watchedWallet.findUnique.mockResolvedValue({
                tags: ['tag1', 'tag2'],
            });
            prismaService.watchedWallet.update.mockResolvedValue({});

            const result = await service.removeWalletTag(
                12345,
                '11111111111111111111111111111111',
                'tag1',
            );

            expect(result).toBe(true);
        });

        it('should get wallet tags', async () => {
            prismaService.watchedWallet.findUnique.mockResolvedValue({
                tags: ['tag1', 'tag2'],
            });

            const result = await service.getWalletTags(
                12345,
                '11111111111111111111111111111111',
            );

            expect(result).toEqual(['tag1', 'tag2']);
        });

        it('should get wallets by tag', async () => {
            prismaService.watchedWallet.findMany.mockResolvedValue([
                { walletAddress: '11111111111111111111111111111111', label: 'Wallet 1' },
            ]);

            const result = await service.getWalletsByTag(12345, 'tag1');

            expect(result).toHaveLength(1);
        });

        it('should get all tags for user', async () => {
            prismaService.watchedWallet.findMany.mockResolvedValue([
                { tags: ['tag1', 'tag2'] },
                { tags: ['tag2', 'tag3'] },
            ]);

            const result = await service.getAllTags(12345);

            expect(result).toContain('tag1');
            expect(result).toContain('tag2');
            expect(result).toContain('tag3');
        });
    });

    describe('Chain Detection', () => {
        it('should detect Solana address', () => {
            const result = service.detectChain(
                'EizqmoCSovbTzuSnmxkdaJwLBBZgyB2GyjN3m3uJWXpZ',
            );
            expect(result).toBe('solana');
        });

        it('should detect Ethereum address', () => {
            const result = service.detectChain(
                '0x742d35Cc6634C0532925a3b844Bc9e7595f42bE0',
            );
            expect(result).toBe('ethereum');
        });

        it('should detect Bitcoin address (P2PKH)', () => {
            const result = service.detectChain('1A1z7agoat4aGEiiYvZiH7nrDkb3QQ5Sk');
            expect(result).toBe('bitcoin');
        });

        it('should detect Tron address', () => {
            const result = service.detectChain(
                'TLAWQwNB2nrLh8iwQHbff6skeq6dotV5Yb',
            );
            expect(result).toBe('tron');
        });

        it('should detect unknown address', () => {
            const result = service.detectChain('unknown-address');
            expect(result).toBe('unknown');
        });
    });

    describe('Chain Error Messages', () => {
        it('should return null for valid Solana address', () => {
            const result = service.chainErrorMessage(
                'EizqmoCSovbTzuSnmxkdaJwLBBZgyB2GyjN3m3uJWXpZ',
            );
            expect(result).toBeNull();
        });

        it('should return error for Ethereum address', () => {
            const result = service.chainErrorMessage(
                '0x742d35Cc6634C0532925a3b844Bc9e7595f42bE0',
            );
            expect(result).toContain('Ethereum');
            expect(result).toContain('not a Solana wallet');
        });

        it('should return error for Bitcoin address', () => {
            const result = service.chainErrorMessage('1A1z7agoat4aGEiiYvZiH7nrDkb3QQ5Sk');
            expect(result).toContain('Bitcoin');
        });

        it('should return error for Tron address', () => {
            const result = service.chainErrorMessage(
                'TLAWQwNB2nrLh8iwQHbff6skeq6dotV5Yb',
            );
            expect(result).toContain('Tron');
        });
    });

    describe('Min Trade Size', () => {
        it('should set minimum trade size', async () => {
            prismaService.user.upsert.mockResolvedValue({});

            await service.setMinTradeSize(12345, 100);

            expect(prismaService.user.upsert).toHaveBeenCalled();
        });

        it('should get minimum trade size', async () => {
            prismaService.user.findUnique.mockResolvedValue({ minTradeSize: 50 });

            const result = await service.getMinTradeSize(12345);

            expect(result).toBe(50);
        });

        it('should return 0 when user not found', async () => {
            prismaService.user.findUnique.mockResolvedValue(null);

            const result = await service.getMinTradeSize(12345);

            expect(result).toBe(0);
        });
    });

    describe('User Tracking', () => {
        it('should track user', async () => {
            prismaService.user.upsert.mockResolvedValue({});

            await service.trackUser(12345, 'testuser');

            expect(prismaService.user.upsert).toHaveBeenCalled();
        });
    });

    describe('Statistics', () => {
        it('should return bot statistics', async () => {
            prismaService.user.count.mockResolvedValue(10);
            prismaService.wallet.count.mockResolvedValue(25);
            prismaService.watchedWallet.groupBy.mockResolvedValue([
                { userId: 1 },
                { userId: 2 },
            ]);

            const result = await service.getStats();

            expect(result).toContain('10');
            expect(result).toContain('25');
            expect(result).toContain('BOT STATS');
        });
    });

    describe('Portfolio', () => {
        it('should reject invalid address', async () => {
            await expect(service.getPortfolio('invalid')).rejects.toThrow(
                'invalid_address',
            );
        });
    });

    describe('Transaction History', () => {
        it('should reject invalid address', async () => {
            await expect(service.getTxHistory('invalid')).rejects.toThrow(
                'invalid_address',
            );
        });
    });

    describe('Token Price', () => {
        it('should return error for unknown token', async () => {
            const result = await service.getTokenPrice('UNKNOWN');

            expect(result).toContain('Could not find price');
        });
    });

    describe('Backfill Trades', () => {
        it('should reject invalid address', async () => {
            const result = await service.backfillTrades('invalid', 100);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid');
        });
    });

    describe('PnL Analysis', () => {
        it('should reject invalid address', async () => {
            await expect(service.getPnlAnalysis('invalid')).rejects.toThrow(
                'invalid_address',
            );
        });

        it('should return no trades message', async () => {
            prismaService.trade.findMany.mockResolvedValue([]);

            const result = await service.getPnlAnalysis(
                'EizqmoCSovbTzuSnmxkdaJwLBBZgyB2GyjN3m3uJWXpZ',
            );

            expect(result).toContain('No trades');
        });
    });

    describe('Error Handling', () => {
        it('should handle database errors', async () => {
            prismaService.watchedWallet.update.mockRejectedValue(
                new Error('DB error'),
            );

            const result = await service.setWalletLabel(
                12345,
                '11111111111111111111111111111111',
                'Label',
            );

            expect(result).toBe(false);
        });
    });
});
