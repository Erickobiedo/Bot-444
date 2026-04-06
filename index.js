import { Telegraf, Markup } from 'telegraf';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import pino from 'pino';
import express from 'express';
import { default as makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason } from '@whiskeysockets/baileys';

const app = express();
const botTelegram = new Telegraf("8605832073:AAEA5JwyvjRZj0yHGTZ-paBIKDS0PNfRjM0");

// --- CONFIGURAÇÃO ---
const DONO_ID = 123456789; // COLOQUE SEU ID DO TELEGRAM AQUI

let sock;
let db;
let estado = { etapa: '', destino: '' };

async function initDb() {
    db = await open({ filename: './database.db', driver: sqlite3.Database });
    await db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, nome TEXT, idade TEXT)`);
}

// --- FLUXO TELEGRAM ---
botTelegram.start((ctx) => {
    if (ctx.from.id !== DONO_ID) return;
    
    ctx.reply(`👋 Olá! Entre nos links abaixo para liberar o sistema:`, 
    Markup.inlineKeyboard([
        [Markup.button.url('📢 Canal', 'https://t.me/+fJHK4uBEE3AyZmUx')],
        [Markup.button.url('💬 Chat', 'https://t.me/sem_nome123456')],
        [Markup.button.callback('✅ Verificar', 'menu_id')]
    ]));
});

botTelegram.action('menu_id', (ctx) => {
    ctx.reply('Onde os registros serão postados?', 
    Markup.inlineKeyboard([
        [Markup.button.callback('ID Canal', 'set_canal')],
        [Markup.button.callback('ID Chat', 'set_chat')],
        [Markup.button.callback('ID Canal + Chat', 'set_ambos')]
    ]));
});

botTelegram.action(['set_canal', 'set_chat', 'set_ambos'], (ctx) => {
    estado.etapa = 'esperando_id';
    ctx.reply('Mande o ID do local escolhido:');
});

botTelegram.on('text', async (ctx) => {
    if (ctx.from.id !== DONO_ID) return;

    if (estado.etapa === 'esperando_id') {
        estado.destino = ctx.message.text;
        estado.etapa = '';
        return ctx.reply(`✅ ID ${estado.destino} configurado!\nPronto para parear o WhatsApp?`, 
        Markup.inlineKeyboard([[Markup.button.callback('🔗 CONECTAR', 'conectar_wa')]]));
    }

    if (estado.etapa === 'esperando_numero') {
        const num = ctx.message.text.replace(/\D/g, '');
        ctx.reply('⏳ Solicitando código para o número...');
        try {
            const code = await sock.requestPairingCode(num);
            ctx.reply(`🔑 CÓDIGO DE PAREAMENTO:\n\n*${code.toUpperCase()}*\n\nAbra o WhatsApp > Aparelhos Conectados > Conectar com número de telefone.`, { parse_mode: 'Markdown' });
            estado.etapa = '';
        } catch (e) {
            ctx.reply('❌ Erro ao gerar código. Tente novamente.');
        }
    }
});

botTelegram.action('conectar_wa', (ctx) => {
    estado.etapa = 'esperando_numero';
    ctx.reply('📱 *Coloque seu número como dono no canal e no chat*\n\nExemplo: 55519XXXXXXXX', { parse_mode: 'Markdown' });
});

// --- LÓGICA WHATSAPP ---
async function startWA() {
    const { state, saveCreds } = await useMultiFileAuthState('sessao_viana');
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;

        const jid = msg.key.remoteJid;
        const txt = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const user = await db.get('SELECT * FROM users WHERE id = ?', [jid]);

        if (!user) {
            if (txt.toLowerCase().startsWith('/registrar')) {
                const p = txt.split(' ');
                if (p.length < 3) return sock.sendMessage(jid, { text: "Use: /registrar Nome Idade" });

                const nome = p[1], idade = p[2], serial = Math.random().toString(16).slice(2, 8), data = new Date().toLocaleString('pt-BR');
                await db.run('INSERT INTO users (id, nome, idade) VALUES (?, ?, ?)', [jid, nome, idade]);

                const layout = `╭───• *NOVO REGISTRO* •───\n├⎆ *Status:* _*Sucesso ✓*_\n├⎆ *Nome:* ${nome} ㅤㅤ#venomㅤㅤ#gothangelz\n├⎆ *Idade:* ${idade}\n├⎆ *Serial:* ***${serial}***\n├⎆ *Data:* ${data}\n╰───────────────`;

                let foto;
                try { foto = await sock.profilePictureUrl(jid, 'image'); } catch { foto = 'https://ui-avatars.com/api/?name=' + nome; }

                if (estado.destino) {
                    await botTelegram.telegram.sendPhoto(estado.destino, { url: foto }, { caption: layout, parse_mode: 'Markdown' });
                }
                await sock.sendMessage(jid, { text: "✅ Registro Concluído!" });
            } else {
                await sock.sendMessage(jid, { text: "❌ *Acesso Negado!*\n\n👉 Digite: */registrar Nome Idade*" });
            }
        }
    });
}

// Inicia Servidores
app.get('/', (req, res) => res.send('Bot Viana Online'));
app.listen(3000, async () => {
    await initDb();
    startWA();
    botTelegram.launch();
});
