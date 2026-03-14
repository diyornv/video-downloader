require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Token .env faylidan olinadi
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Sizning shaxsiy serveringizdagi Cobalt API manzili
const COBALT_API_URL = 'http://178.128.199.137:9000/';

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    if (text === '/start') {
        return bot.sendMessage(chatId, "Salom! Menga Instagram, TikTok, Pinterest yoki YouTube linkini yuboring.");
    }

    if (text.startsWith('http://') || text.startsWith('https://')) {

        // 1. YouTube cheklovi
        if (text.includes('youtube.com') || text.includes('youtu.be')) {
            return bot.sendMessage(chatId, "Hozirda YouTube'dan yuklash cheklangan, ishlashi bilan habar beramiz.");
        }

        // 2. Ruxsat berilgan platformalar
        if (text.includes('instagram.com') || text.includes('tiktok.com') || text.includes('vm.tiktok.com') || text.includes('pinterest.com') || text.includes('pin.it')) {

            bot.sendMessage(chatId, "Kuting, yuklanmoqda... ⏳");

            try {
                const response = await axios.post(COBALT_API_URL, {
                    url: text
                }, {
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                });

                const data = response.data;

                // Natija muvaffaqiyatli bo'lsa
                if (data.status === 'redirect' || data.status === 'tunnel' || data.status === 'success') {
                    // Video tagiga yashirin ssilka bilan yozuv qo'shish
                    await bot.sendVideo(chatId, data.url, {
                        caption: 'Video <a href="https://t.me/pinterest_downloader_uzbot">pinterest_downloader_uzbot</a> dan yuklandi',
                        parse_mode: 'HTML'
                    });
                } else if (data.status === 'picker') {
                    bot.sendMessage(chatId, "Bu linkda bir nechta rasm/video bor ekan. Hozircha faqat bittalik videolarni yuklay olaman.");
                } else {
                    bot.sendMessage(chatId, "Faylni yuklab olishda muammo yuzaga keldi.");
                }
            } catch (error) {
                console.error("API Xatosi:", error.message);
                bot.sendMessage(chatId, "Server bilan ulanishda xatolik yuz berdi. Iltimos keyinroq qayta urinib ko'ring.");
            }
        } else {
            bot.sendMessage(chatId, "Men faqat Instagram, TikTok, Pinterest va YouTube linklarini qabul qilaman.");
        }
    } else {
        bot.sendMessage(chatId, "Iltimos, faqat link yuboring.");
    }
});

console.log('Bot ishga tushdi...');