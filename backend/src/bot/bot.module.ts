import { Module } from '@nestjs/common';
import { BotUpdate } from './bot.update';
import { SolanaModule } from '../solana/solana.module';

@Module({
  imports: [SolanaModule],
  providers: [BotUpdate],
})
export class BotModule {}
