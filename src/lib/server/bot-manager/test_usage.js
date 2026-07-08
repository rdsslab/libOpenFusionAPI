import { BotManager } from './manager.js';

// 1. Mock Database
const DB_BOTS = [
    {
        id: 'bot_1',
        token: '1878582988:AAH3Q1j5LzAo8cEBXYtMEEEy4swosLq6SZ8', // This will fail auth in real grammy (401 Unauthorized)
        code: `
            $BOT.command('start', (ctx) => ctx.reply('Hello from Bot 1!'));
            console.log('Bot 1 handlers configured');
        `
    },
    {
        id: 'bot_2',
        token: 'invalid_token_format', // This will fail token format validation or request validation
        code: `
            $BOT.on('message', (ctx) => ctx.reply('Bot 2 echo: ' + ctx.message.text));
            console.log('Bot 2 handlers configured');
        `
    }
];

// 2. Run Usage
async function main() {
    const manager = new BotManager();

    console.log('--- Starting System (grammY edition) ---');

    // Register log listener to verify it receives events
    manager.on("bot_log", (log) => {
        console.log("\n[LOG EVENT RECEIVED]", JSON.stringify(log, null, 2));
    });

    console.log('Starting Bot 1 (should fail with 401 Unauthorized)...');
    try {
        await manager.startBot(DB_BOTS[0].id, DB_BOTS[0].token, DB_BOTS[0].code, 'dev', {}, 'app_123');
    } catch (err) {
        console.error('Bot 1 Start Failed (Expected):', err.message);
    }

    console.log('\nStarting Bot 2 (should fail with connection or parsing error)...');
    try {
        await manager.startBot(DB_BOTS[1].id, DB_BOTS[1].token, DB_BOTS[1].code, 'dev', {}, 'app_123');
    } catch (err) {
        console.error('Bot 2 Start Failed (Expected):', err.message);
    }

    console.log('\nActive Bots:', manager.listActiveBots());
}

main().catch(console.error);
