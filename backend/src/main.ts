import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { execSync } from 'child_process';

async function bootstrap() {
  console.log('Running database migrations...');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });

  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
  console.log('Sol Wallet Watcher is running');
}
bootstrap();
