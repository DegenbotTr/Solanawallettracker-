"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const child_process_1 = require("child_process");
async function bootstrap() {
    console.log('Running database migrations...');
    (0, child_process_1.execSync)('npx prisma migrate deploy', { stdio: 'inherit' });
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    await app.listen(3000);
    console.log('Sol Wallet Watcher is running');
}
bootstrap();
//# sourceMappingURL=main.js.map