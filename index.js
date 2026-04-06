import { Telegraf, Markup } from 'telegraf';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import pino from 'pino';
import express from 'express';
import { default as makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason } from '@whiskeysockets/baileys';

const app = express();
// Token do seu bot do Telegram
const botTelegram = new Telegraf("8605832073:AAFhV8WjcWSFuTScFTV_d6SybyKERAaROII");

let sock;
let db;
// Objeto para armazenar as etapas de cada utilizador individualmente
let estadosUsuarios = {}; 

async function initDb() {
    db = await open({ filename: './database.db', driver: sqlite3.Database });
    await db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, nome TEXT, idade TEXT)`);
}

// --- FLUXO TELEGRAM (LIBERADO PARA TODOS) ---
botTelegram.start((ctx) => {
    const userId = ctx.from.id;
    estadosUsuarios[userId] = { etapa: '', destino: '' };

    ctx.reply(`👋 Bem-vindo ao Sistema Viana!\n\nEntre nos canais abaixo para libertar o seu acesso:`, 
    Markup.inlineKeyboard([
        [Markup.button.url('📢 Canal', 'https://t.me/+fJHK4uBEE3AyZmUx')],
        [Markup.button.url('💬 Chat', 'https://t.me/sem_nome123456')],
        [Markup.button.callback('✅ Verificar e Entrar', 'menu_id')]
    ]));
});

botTelegram.action('menu_id', (ctx) => {
    ctx.reply('Onde deseja receber os logs de registro?', 
    Markup.inlineKeyboard([
        [Markup.button.callback('ID Canal', 'set_canal')],
        [Markup.button.callback('ID Chat', 'set_chat')],
        [Markup.button.callback('ID Canal + Chat', 'set_ambos')]
    ]));
});

botTelegram.action(['set_canal', 'set_chat', 'set_ambos'], (ctx) => {
    const userId = ctx.from.id;
    estadosUsuarios[userId].etapa = 'esperando_id';
    ctx.reply('Mande agora o ID do local (ex: -100...):');
});

botTelegram.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const txtMsg = ctx.message.text;

    if (!estadosUsuarios[userId]) estadosUsuarios[userId] = { etapa: '', destino: '' };

    if (estadosUsuarios[userId].etapa === 'esperando_id') {
        estadosUsuarios[userId].destino = txtMsg;
        estadosUsuarios[userId].etapa = '';
        return ctx.reply(`✅ Destino configurado: ${txtMsg}\n\nPronto para conectar o seu WhatsApp?`, 
        Markup.inlineKeyboard([[Markup.button.callback('🔗 CONECTAR AGORA', 'conectar_wa')]]));
    }

    if (estadosUsuarios[userId].etapa === 'esperando_numero') {
        const num = txtMsg.replace(/\D/g, '');
        ctx.reply('⏳ A gerar código de pareamento...');
        try {
            // Gera o código de 8 dígitos para o número enviado
            const code = await sock.requestPairingCode(num);
            ctx.reply(`🔑 O SEU CÓDIGO É:\n\n*${code.toUpperCase()}*\n\nInstruções:\n1. Abra o WhatsApp\n2. Dispositivos Associados\n3. Associar com número de telefone\n4. Digite o código acima`, { parse_mode: 'Markdown' });
            estadosUsuarios[userId].etapa = '';
        } catch (e) {
            ctx.reply('❌ Erro ao gerar código. Verifique o número e tente novamente.');
        }
    }
});

botTelegram.action('conectar_wa', (ctx) => {
    const userId = ctx.from.id;
    estadosUsuarios[userId].etapa = 'esperando_numero';
    ctx.reply('📱 *Coloque o seu número para ser o dono no canal e no chat*\n\nExemplo: 55519XXXXXXXX', { parse_mode: 'Markdown' });
});

// --- LÓGICA WHATSAPP (RESPONDE A TODOS) ---
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
        const texto = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        
        const user = await db.get('SELECT * FROM users WHERE id = ?', [jid]);

        if (!user) {
            if (texto.toLowerCase().startsWith('/registrar')) {
                const p = texto.split(' ');
                if (p.length < 3) return sock.sendMessage(jid, { text: "⚠️ Use: /registrar Nome Idade" });

                const nome = p[1], idade = p[2], serial = Math.random().toString(16).slice(2, 8), data = new Date().toLocaleString('pt-BR');
                await db.run('INSERT INTO users (id, nome, idade) VALUES (?, ?, ?)', [jid, nome, idade]);

                const layout = `╭───• *NOVO REGISTRO* •───\n├⎆ *Status:* _*Sucesso ✓*_\n├⎆ *Nome:* ${nome} ㅤㅤ#venomㅤㅤ#gothangelz\n├⎆ *Idade:* ${idade}\n├⎆ *Serial:* ***${serial}***\n├⎆ *Data:* ${data}\n╰───────────────`;

                let foto;
                try { foto = await sock.profilePictureUrl(jid, 'image'); } catch { foto = 'https://ui-avatars.com/api/?name=' + nome; }

                // Envia para o destino que o utilizador configurou no Telegram
                // Nota: Esta lógica assume o destino do último utilizador que configurou. 
                // Para sistemas multi-utilizador reais, o destino deve ser salvo por JID no DB.
                const lastUser = Object.values(estadosUsuarios).pop();
                if (lastUser?.destino) {
                    await botTelegram.telegram.sendPhoto(lastUser.destino, { url: foto }, { caption: layout, parse_mode: 'Markdown' });
                }
                
                await sock.sendMessage(jid, { text: "✅ Registro Concluído!" });
            } else {
                await sock.sendMessage(jid, { text: "❌ *Acesso Negado!*\n\nRegiste-se para usar:\n/registrar Nome Idade" });
            }
        }
    });
}

// Servidor e Inicialização
app.get('/', (req, res) => res.send('Bot Viana Público Ativo'));
app.listen(3000, async () => {
    await initDb();
    startWA();
    botTelegram.launch();
    console.log('🚀 Sistema aberto para todos!');
});
