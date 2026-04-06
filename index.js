import { Telegraf } from 'telegraf';
import baileys from '@whiskeysockets/baileys';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = baileys.default || baileys;

// --- CONFIGURAÇÕES ---
const TELEGRAM_TOKEN = 'SEU_TOKEN_AQUI'; // Pegue no @BotFather
const canalLog = "120363339031174676@newsletter";
const grupoLog = "F9mebHrNzLP1cOAC2NkA0Z@g.us";

const botTelegram = new Telegraf(TELEGRAM_TOKEN);
let sock;
let db;

async function iniciarTudo() {
    // 1. Banco de Dados
    db = await open({ filename: path.join(__dirname, 'database.db'), driver: sqlite3.Database });
    await db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, nome TEXT)`);

    // 2. Estado do WhatsApp
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info'));
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    // --- LÓGICA DO WHATSAPP (REGISTRO NO PRIVADO) ---
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;

        const jid = msg.key.remoteJid;
        const nome = msg.pushName || "Usuário";
        const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        // Verifica se é o primeiro contato (Registro Automático)
        const user = await db.get('SELECT * FROM users WHERE id = ?', [jid]);

        if (!user) {
            // Salva no Banco
            await db.run('INSERT INTO users (id, nome) VALUES (?, ?)', [jid, nome]);
            
            // Responde ao usuário
            await sock.sendMessage(jid, { text: `Olá ${nome}! Você foi registrado automaticamente em nosso sistema. ✅` });

            // Envia Log para Canal e Grupo
            const logMsg = `📢 *NOVO REGISTRO PRIVADO*\n\n👤 *Nome:* ${nome}\n🆔 *Número:* ${jid.split('@')[0]}`;
            await sock.sendMessage(canalLog, { text: logMsg }).catch(() => {});
            await sock.sendMessage(grupoLog, { text: logMsg }).catch(() => {});
        }
    });

    console.log("🤖 Sistemas iniciados...");
}

// --- COMANDOS DO TELEGRAM ---
botTelegram.start((ctx) => ctx.reply('Use /conectar [numero] para vincular o WhatsApp.'));

botTelegram.command('conectar', async (ctx) => {
    const numero = ctx.message.text.split(' ')[1];
    if (!numero) return ctx.reply('Digite o número: /conectar 555194583978');

    try {
        const code = await sock.requestPairingCode(numero.replace(/\D/g, ''));
        ctx.reply(`✅ CÓDIGO PARA WHATSAPP:\n\n👉 ${code.toUpperCase()}`);
    } catch (e) {
        ctx.reply('Erro: ' + e.message);
    }
});

// Iniciar
iniciarTudo();
botTelegram.launch();
