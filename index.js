import { Telegraf, Markup } from 'telegraf';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import pino from 'pino';
import express from 'express';
import { default as makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason } from '@whiskeysockets/baileys';

const app = express();
// Substitua pelo seu Token real do BotFather
const botTelegram = new Telegraf("8605832073:AAFhV8WjcWSFuTScFTV_d6SybyKERAaROII");

let sock;
let db;
let estadosUsuarios = {}; 

async function initDb() {
    db = await open({ filename: './database.db', driver: sqlite3.Database });
    await db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, nome TEXT, idade TEXT)`);
}

// --- INTERFACE TELEGRAM (ABERTO A TODOS) ---
botTelegram.start((ctx) => {
    const userId = ctx.from.id;
    estadosUsuarios[userId] = { etapa: '', destino: '' };

    ctx.reply(`👋 Bem-vindo ao Sistema Viana!\n\nEntre nos canais para liberar o acesso:`, 
    Markup.inlineKeyboard([
        [Markup.button.url('📢 Canal', 'https://t.me/+fJHK4uBEE3AyZmUx')],
        [Markup.button.url('💬 Chat', 'https://t.me/sem_nome123456')],
        [Markup.button.callback('✅ Verificar e Configurar', 'menu_id')]
    ]));
});

botTelegram.action('menu_id', (ctx) => {
    ctx.reply('Onde os logs de registro serão postados?', 
    Markup.inlineKeyboard([
        [Markup.button.callback('ID Canal', 'set_canal')],
        [Markup.button.callback('ID Chat', 'set_chat')],
        [Markup.button.callback('ID Canal + Chat', 'set_ambos')]
    ]));
});

botTelegram.action(['set_canal', 'set_chat', 'set_ambos'], (ctx) => {
    const userId = ctx.from.id;
    estadosUsuarios[userId].etapa = 'esperando_id';
    ctx.reply('Mande o ID do local (Ex: -100... ou o JID do WhatsApp):');
});

botTelegram.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const txtMsg = ctx.message.text;

    if (!estadosUsuarios[userId]) estadosUsuarios[userId] = { etapa: '', destino: '' };

    // Configuração do ID de destino
    if (estadosUsuarios[userId].etapa === 'esperando_id') {
        estadosUsuarios[userId].destino = txtMsg;
        estadosUsuarios[userId].etapa = '';
        return ctx.reply(`✅ Destino configurado: ${txtMsg}\n\nPronto para conectar o WhatsApp?`, 
        Markup.inlineKeyboard([[Markup.button.callback('🔗 CONECTAR AGORA', 'conectar_wa')]]));
    }

    // Geração do código de pareamento
    if (estadosUsuarios[userId].etapa === 'esperando_numero') {
        const num = txtMsg.replace(/\D/g, '');
        if (num.length < 10) return ctx.reply("❌ Número inválido. Use o formato: 5551994583978");

        ctx.reply('⏳ Solicitando código ao WhatsApp... (Aguarde 5s)');
        
        try {
            // Delay preventivo para evitar bloqueio de IP
            await new Promise(res => setTimeout(res, 5000));
            
            const code = await sock.requestPairingCode(num);
            ctx.reply(`🔑 SEU CÓDIGO DE CONEXÃO:\n\n*${code.toUpperCase()}*\n\nAbra o WhatsApp > Aparelhos Conectados > Conectar com número.`, { parse_mode: 'Markdown' });
            console.log(`✅ Código gerado para ${num}: ${code}`);
            estadosUsuarios[userId].etapa = '';
        } catch (e) {
            console.error("❌ ERRO AO GERAR CÓDIGO:", e);
            ctx.reply('❌ O WhatsApp recusou o pedido.\n\n1. Verifique se o número tem o 55.\n2. Espere 15 minutos e tente de novo.\n3. Apague a pasta sessao_viana no Replit.');
        }
    }
});

botTelegram.action('conectar_wa', (ctx) => {
    const userId = ctx.from.id;
    estadosUsuarios[userId].etapa = 'esperando_numero';
    ctx.reply('📱 *Mande seu número abaixo (Dono)*\n\nExemplo: 5551994583978', { parse_mode: 'Markdown' });
});

// --- LÓGICA WHATSAPP ---
async function startWA() {
    const { state, saveCreds } = await useMultiFileAuthState('sessao_viana');
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        // Browser simulando Safari no Mac para maior aceitação do WhatsApp
        browser: ["Mac OS", "Safari", "15.1"],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect } = u;
        if (connection === 'open') console.log('✅ WhatsApp Conectado com Sucesso!');
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startWA();
        }
    });

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

                // Pega o último destino configurado por qualquer usuário no Telegram
                const listaEstados = Object.values(estadosUsuarios);
                const configAtiva = listaEstados.reverse().find(u => u.destino);
                
                if (configAtiva?.destino) {
                    // Envia para o WhatsApp (Canal ou Grupo) se o destino for JID
                    if (configAtiva.destino.includes('@')) {
                        await sock.sendMessage(configAtiva.destino, { image: { url: foto }, caption: layout });
                    } 
                    // Envia para o Telegram se o destino for ID numérico
                    else {
                        await botTelegram.telegram.sendPhoto(configAtiva.destino, { url: foto }, { caption: layout, parse_mode: 'Markdown' });
                    }
                }
                
                await sock.sendMessage(jid, { text: "✅ *Registro Concluído com Sucesso!*" });
            } else {
                await sock.sendMessage(jid, { text: "❌ *Acesso Negado!*\n\nPara usar o sistema, registre-se primeiro:\n👉 */registrar Nome Idade*" });
            }
        }
    });
}

// Inicialização do Servidor Express para o Replit não dormir
app.get('/', (req, res) => res.send('Bot Online!'));
app.listen(3000, async () => {
    await initDb();
    startWA();
    botTelegram.launch();
    console.log('🚀 Sistemas integrados e prontos!');
});
