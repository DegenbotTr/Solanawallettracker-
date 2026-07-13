import { Test, TestingModule } from '@nestjs/testing';
import { BotUpdate } from './bot.update';
import { SolanaService } from '../solana/solana.service';

describe('BotUpdate', () => {
    let botUpdate: BotUpdate;
    let solanaService: jest.Mocked<SolanaService>;
    let mockCtx: any;

    beforeEach(async () => {
        // Mock SolanaService
        solanaService = {
            trackUser: jest.fn(),
            getWatchedWallets: jest.fn(),
            getMinTradeSize: jest.fn(),
            watchWallet: jest.fn(),
            unwatchWallet: jest.fn(),
            getWalletLabel: jest.fn(),
            setWalletLabel: jest.fn(),
            chainErrorMessage: jest.fn(),
            getPortfolio: jest.fn(),
            getTxHistory: jest.fn(),
            getPnlAnalysis: jest.fn(),
            getTokenPrice: jest.fn(),
            backfillTrades: jest.fn(),
            setMinTradeSize: jest.fn(),
            getStats: jest.fn(),
        } as any;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BotUpdate,
                { provide: SolanaService, useValue: solanaService },
            ],
        }).compile();

        botUpdate = module.get<BotUpdate>(BotUpdate);

        // Setup default mock context with proper types
        mockCtx = {
            chat: { id: 12345, type: 'private' },
            from: { id: 1, first_name: 'Test', username: 'testuser', is_bot: false },
            message: {
                text: '',
                chat: { id: 12345, type: 'private' },
                from: { id: 1, is_bot: false },
                message_id: 1,
                date: Math.floor(Date.now() / 1000),
            },
            reply: jest.fn().mockResolvedValue({ message_id: 1 }),
            editMessageText: jest.fn().mockResolvedValue({}),
            answerCbQuery: jest.fn().mockResolvedValue(true),
            telegram: {
                editMessageText: jest.fn().mockResolvedValue({}),
            },
        };
    });

    describe('Start Command', () => {
        it('should send welcome message on /start', async () => {
            await botUpdate.onStart(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledTimes(2);
            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Welcome, Test'),
                expect.any(Object),
            );
            expect(solanaService.trackUser).toHaveBeenCalledWith(12345, 'testuser');
        });

        it('should track user on start', async () => {
            await botUpdate.onStart(mockCtx);
            expect(solanaService.trackUser).toHaveBeenCalled();
        });
    });

    describe('Help Command', () => {
        it('should send help message on /help', async () => {
            await botUpdate.onHelp(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Commands'),
                expect.any(Object),
            );
        });
    });

    describe('Menu Command', () => {
        it('should show main menu on /menu', async () => {
            await botUpdate.onMenu(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Main Menu'),
                expect.any(Object),
            );
        });
    });

    describe('Watch Command', () => {
        it('should add wallet when address provided', async () => {
            Object.defineProperty(mockCtx, 'message', {
                value: {
                    text: '/watch 11111111111111111111111111111111',
                    chat: { id: 12345, type: 'private' },
                    from: { id: 1, is_bot: false },
                    message_id: 1,
                    date: Math.floor(Date.now() / 1000),
                },
                writable: true,
            });
            solanaService.chainErrorMessage.mockReturnValue(null);
            solanaService.watchWallet.mockResolvedValue(true);

            await botUpdate.onWatch(mockCtx);

            expect(solanaService.watchWallet).toHaveBeenCalledWith(
                '11111111111111111111111111111111',
                12345,
            );
            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Wallet Added'),
                expect.any(Object),
            );
        });

        it('should prompt for address when none provided', async () => {
            Object.defineProperty(mockCtx, 'message', {
                value: {
                    text: '/watch',
                    chat: { id: 12345, type: 'private' },
                    from: { id: 1, is_bot: false },
                    message_id: 1,
                    date: Math.floor(Date.now() / 1000),
                },
                writable: true,
            });

            await botUpdate.onWatch(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Add Wallet'),
                expect.any(Object),
            );
        });

        it('should reject invalid address', async () => {
            Object.defineProperty(mockCtx, 'message', {
                value: {
                    text: '/watch invalid',
                    chat: { id: 12345, type: 'private' },
                    from: { id: 1, is_bot: false },
                    message_id: 1,
                    date: Math.floor(Date.now() / 1000),
                },
                writable: true,
            });
            solanaService.chainErrorMessage.mockReturnValue(
                '❌ Not a valid Solana address',
            );

            await botUpdate.onWatch(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Not a valid Solana address'),
                expect.any(Object),
            );
        });

        it('should handle invalid wallet address', async () => {
            Object.defineProperty(mockCtx, 'message', {
                value: {
                    text: '/watch 11111111111111111111111111111111',
                    chat: { id: 12345, type: 'private' },
                    from: { id: 1, is_bot: false },
                    message_id: 1,
                    date: Math.floor(Date.now() / 1000),
                },
                writable: true,
            });
            solanaService.chainErrorMessage.mockReturnValue(null);
            solanaService.watchWallet.mockResolvedValue(false);

            await botUpdate.onWatch(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Invalid address'),
                expect.any(Object),
            );
        });
    });

    describe('Unwatch Command', () => {
        it('should remove wallet when address provided', async () => {
            Object.defineProperty(mockCtx, 'message', {
                value: {
                    text: '/unwatch 11111111111111111111111111111111',
                    chat: { id: 12345, type: 'private' },
                    from: { id: 1, is_bot: false },
                    message_id: 1,
                    date: Math.floor(Date.now() / 1000),
                },
                writable: true,
            });
            solanaService.unwatchWallet.mockResolvedValue(true);

            await botUpdate.onUnwatch(mockCtx);

            expect(solanaService.unwatchWallet).toHaveBeenCalledWith(
                '11111111111111111111111111111111',
                12345,
            );
            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Wallet Removed'),
                expect.any(Object),
            );
        });

        it('should show wallet list when no address provided', async () => {
            Object.defineProperty(mockCtx, 'message', {
                value: {
                    text: '/unwatch',
                    chat: { id: 12345, type: 'private' },
                    from: { id: 1, is_bot: false },
                    message_id: 1,
                    date: Math.floor(Date.now() / 1000),
                },
                writable: true,
            });
            solanaService.getWatchedWallets.mockResolvedValue([
                { address: '11111111111111111111111111111111', label: 'Test Wallet' },
            ]);

            await botUpdate.onUnwatch(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Remove Wallet'),
                expect.any(Object),
            );
        });

        it('should show message when no wallets to unwatch', async () => {
            Object.defineProperty(mockCtx, 'message', {
                value: {
                    text: '/unwatch',
                    chat: { id: 12345, type: 'private' },
                    from: { id: 1, is_bot: false },
                    message_id: 1,
                    date: Math.floor(Date.now() / 1000),
                },
                writable: true,
            });
            solanaService.getWatchedWallets.mockResolvedValue([]);

            await botUpdate.onUnwatch(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                'You have no wallets being watched.',
            );
        });

        it('should handle wallet not found', async () => {
            Object.defineProperty(mockCtx, 'message', {
                value: {
                    text: '/unwatch 11111111111111111111111111111111',
                    chat: { id: 12345, type: 'private' },
                    from: { id: 1, is_bot: false },
                    message_id: 1,
                    date: Math.floor(Date.now() / 1000),
                },
                writable: true,
            });
            solanaService.unwatchWallet.mockResolvedValue(false);

            await botUpdate.onUnwatch(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining("isn't in your watch list"),
            );
        });
    });

    describe('List Command', () => {
        it('should show wallet list', async () => {
            solanaService.getWatchedWallets.mockResolvedValue([
                { address: '11111111111111111111111111111111', label: 'Wallet 1' },
            ]);
            solanaService.getMinTradeSize.mockResolvedValue(100);

            await botUpdate.onList(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Watched Wallets'),
                expect.any(Object),
            );
        });

        it('should show empty state when no wallets', async () => {
            solanaService.getWatchedWallets.mockResolvedValue([]);
            solanaService.getMinTradeSize.mockResolvedValue(0);

            await botUpdate.onList(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('No wallets watched yet'),
                expect.any(Object),
            );
        });
    });

    describe('Stats Command', () => {
        it('should show stats', async () => {
            solanaService.getStats.mockResolvedValue('Stats data');

            await botUpdate.onStats(mockCtx);

            expect(solanaService.getStats).toHaveBeenCalled();
            expect(mockCtx.reply).toHaveBeenCalledWith('Stats data', expect.any(Object));
        });
    });

    describe('Main Menu Callbacks', () => {
        it('should handle menu_main callback', async () => {
            mockCtx.match = [];

            await botUpdate.onMenuMain(mockCtx);

            expect(mockCtx.answerCbQuery).toHaveBeenCalled();
            expect(mockCtx.editMessageText).toHaveBeenCalledWith(
                expect.stringContaining('Main Menu'),
                expect.any(Object),
            );
        });

        it('should handle menu_watch callback', async () => {
            await botUpdate.onMenuWatch(mockCtx);

            expect(mockCtx.answerCbQuery).toHaveBeenCalled();
            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Add Wallet'),
                expect.any(Object),
            );
        });

        it('should handle menu_list callback', async () => {
            solanaService.getWatchedWallets.mockResolvedValue([]);
            solanaService.getMinTradeSize.mockResolvedValue(0);

            await botUpdate.onMenuList(mockCtx);

            expect(mockCtx.answerCbQuery).toHaveBeenCalled();
        });

        it('should handle menu_stats callback', async () => {
            solanaService.getStats.mockResolvedValue('Stats');

            await botUpdate.onMenuStats(mockCtx);

            expect(mockCtx.answerCbQuery).toHaveBeenCalled();
            expect(mockCtx.reply).toHaveBeenCalledWith('Stats', expect.any(Object));
        });

        it('should handle menu_help callback', async () => {
            await botUpdate.onMenuHelp(mockCtx);

            expect(mockCtx.answerCbQuery).toHaveBeenCalled();
            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Commands'),
                expect.any(Object),
            );
        });
    });

    describe('Wallet Panel Callbacks', () => {
        it('should handle wallet_open callback', async () => {
            mockCtx.match = ['wallet_open:11111111111111111111111111111111', '11111111111111111111111111111111'];
            solanaService.getWalletLabel.mockResolvedValue('Test Wallet');

            await botUpdate.onWalletOpen(mockCtx);

            expect(mockCtx.answerCbQuery).toHaveBeenCalled();
            expect(mockCtx.editMessageText).toHaveBeenCalledWith(
                expect.stringContaining('111111...1111'),
                expect.any(Object),
            );
        });

        it('should handle wallet_unwatch callback', async () => {
            mockCtx.match = ['wallet_unwatch:11111111111111111111111111111111', '11111111111111111111111111111111'];
            solanaService.unwatchWallet.mockResolvedValue(true);

            await botUpdate.onWalletUnwatch(mockCtx);

            expect(mockCtx.answerCbQuery).toHaveBeenCalled();
        });
    });

    describe('Error Handling', () => {
        it('should handle portfolio fetch error', async () => {
            Object.defineProperty(mockCtx, 'message', {
                value: {
                    text: '/portfolio 11111111111111111111111111111111',
                    chat: { id: 12345, type: 'private' },
                    from: { id: 1, is_bot: false },
                    message_id: 1,
                    date: Math.floor(Date.now() / 1000),
                },
                writable: true,
            });
            solanaService.chainErrorMessage.mockReturnValue(null);
            solanaService.getPortfolio.mockRejectedValue(new Error('API error'));

            await botUpdate.onPortfolio(mockCtx);

            expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
                12345,
                1,
                undefined,
                expect.stringContaining('Failed to fetch portfolio'),
                expect.any(Object),
            );
        });
    });

    describe('Chain Error Detection', () => {
        it('should show chain error for non-Solana address', async () => {
            Object.defineProperty(mockCtx, 'message', {
                value: {
                    text: '/portfolio 0x123',
                    chat: { id: 12345, type: 'private' },
                    from: { id: 1, is_bot: false },
                    message_id: 1,
                    date: Math.floor(Date.now() / 1000),
                },
                writable: true,
            });
            solanaService.chainErrorMessage.mockReturnValue(
                '❌ This looks like an Ethereum address',
            );

            await botUpdate.onPortfolio(mockCtx);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Ethereum address'),
                expect.any(Object),
            );
        });
    });
});
