import { Telegraf, Markup } from 'telegraf';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import pino from 'pino';
import express from 'express';
import QRCode from 'qrcode';
import { default as makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';

const app = express();
const botTelegram = new Telegraf("8605832073:AAFhV8WjcWSFuTScFTV_d6SybyKERAaROII");

let sock;
let db;
let estadosUsuarios = {};
let waConectado = false;

// ---------------- DATABASE ----------------
async function initDb() {
    db = await open({ filename: './database.db', driver: sqlite3.Database });
    await db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, nome TEXT, idade TEXT)`);
}

// ---------------- TELEGRAM ----------------
botTelegram.start((ctx) => {
    const userId = ctx.from.id;

    estadosUsuarios[userId] = { etapa: '', destino: '' };

    ctx.reply(`👋 Bem-vindo ao Sistema Viana!\n\nEntre nos canais para liberar o acesso:`,
        Markup.inlineKeyboard([
            [Markup.button.url('📢 Canal', 'https://t.me/+fJHK4uBEE3AyZmUx')],
            [Markup.button.url('💬 Chat', 'https://t.me/sem_nome123456')],
            [Markup.button.callback('✅ Verificar e Configurar', 'menu_id')]
        ])
    );
});

botTelegram.action('menu_id', (ctx) => {
    ctx.reply('Onde os logs serão enviados?',
        Markup.inlineKeyboard([
            [Markup.button.callback('ID Canal', 'set_canal')],
            [Markup.button.callback('ID Chat', 'set_chat')],
            [Markup.button.callback('Ambos', 'set_ambos')]
        ])
    );
});

botTelegram.action(['set_canal', 'set_chat', 'set_ambos'], (ctx) => {
    const userId = ctx.from.id;
    estadosUsuarios[userId].etapa = 'esperando_id';

    ctx.reply('Envie o ID (Telegram ou JID WhatsApp)');
});

// ---------------- TEXTOS ----------------
botTelegram.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const txtMsg = ctx.message.text;

    if (!estadosUsuarios[userId]) {
        estadosUsuarios[userId] = { etapa: '', destino: '' };
    }

    // -------- SALVAR DESTINO --------
    if (estadosUsuarios[userId].etapa === 'esperando_id') {
        estadosUsuarios[userId].destino = txtMsg;
        estadosUsuarios[userId].etapa = '';

        return ctx.reply(`✅ Destino salvo: ${txtMsg}\n\nComo deseja conectar?`,
            Markup.inlineKeyboard([
                [Markup.button.callback('🔑 Número', 'conectar_numero')],
                [Markup.button.callback('📷 QR Code', 'conectar_qr')]
            ])
        );
    }

    // -------- CONECTAR COM NÚMERO --------
    if (estadosUsuarios[userId].etapa === 'esperando_numero') {

        if (!sock) return ctx.reply("❌ WhatsApp não iniciou.");
        if (!waConectado) return ctx.reply("⏳ Aguarde conexão do WhatsApp...");

        const num = txtMsg.replace(/\D/g, '');

        if (!num.startsWith('55')) {
            return ctx.reply("❌ Use com 55. Ex: 5551999999999");
        }

        if (num.length < 12) {
            return ctx.reply("❌ Número inválido.");
        }

        ctx.reply('⏳ Gerando código...');

        try {
            await new Promise(res => setTimeout(res, 15000));

            const code = await sock.requestPairingCode(num);

            await ctx.reply(
                `🔑 *CÓDIGO:*\n\n${code.toUpperCase()}\n\nAbra WhatsApp > Aparelhos conectados`,
                { parse_mode: 'Markdown' }
            );

            estadosUsuarios[userId].etapa = '';

        } catch (e) {
            console.log(e);

            ctx.reply(
                "❌ WhatsApp recusou.\n\nEspere 10 min\nApague pasta sessao_viana"
            );
        }
    }
});

// -------- BOTÕES --------
botTelegram.action('conectar_numero', (ctx) => {
    const userId = ctx.from.id;
    estadosUsuarios[userId].etapa = 'esperando_numero';

    ctx.reply('📱 Envie seu número\nEx: 5551999999999');
});

botTelegram.action('conectar_qr', (ctx) => {
    ctx.reply('📷 Aguarde... QR será enviado aqui');
});

// ---------------- WHATSAPP ----------------
async function startWA() {

    const { state, saveCreds } = await useMultiFileAuthState('sessao_viana');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Mac OS", "Safari", "15.1"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // -------- QR --------
        if (qr) {
            try {
                const qrImage = await QRCode.toBuffer(qr);

                for (const userId in estadosUsuarios) {
                    await botTelegram.telegram.sendPhoto(userId, { source: qrImage }, {
                        caption: "📷 Escaneie no WhatsApp"
                    });
                }

            } catch (err) {
                console.log("Erro QR:", err);
            }
        }

        if (connection === 'open') {
            waConectado = true;
            console.log('✅ WhatsApp conectado');
        }

        if (connection === 'close') {
            waConectado = false;

            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) {
                console.log("🔄 Reconectando...");
                startWA();
            }
        }
    });

    // -------- MENSAGENS --------
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];

        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;

        const jid = msg.key.remoteJid;
        const texto = (msg.message.conversation || "").trim();

        const user = await db.get('SELECT * FROM users WHERE id = ?', [jid]);

        if (!user) {
            if (texto.toLowerCase().startsWith('/registrar')) {

                const p = texto.split(' ');
                if (p.length < 3) {
                    return sock.sendMessage(jid, { text: "Use: /registrar Nome Idade" });
                }

                const nome = p[1];
                const idade = p[2];

                await db.run('INSERT INTO users (id, nome, idade) VALUES (?, ?, ?)', [jid, nome, idade]);

                await sock.sendMessage(jid, { text: "✅ Registrado com sucesso!" });

            } else {
                await sock.sendMessage(jid, {
                    text: "❌ Use /registrar Nome Idade"
                });
            }
        }
    });
}

// ---------------- SERVER ----------------
app.get('/', (req, res) => res.send('Bot Online!'));

app.listen(3000, async () => {
    await initDb();
    await startWA();
    botTelegram.launch();

    console.log('🚀 SISTEMA ONLINE');
});
