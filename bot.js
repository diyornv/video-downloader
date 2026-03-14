require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Token .env faylidan olinadi
const token = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const bot = new TelegramBot(token, { polling: true });

// Sizning shaxsiy serveringizdagi Cobalt API manzili
const COBALT_API_URL = 'http://178.128.199.137:9000/';

// Users faylini saqlash
const USERS_FILE = path.join(__dirname, 'users.json');

// Post rejimida turgan adminlar
const postMode = new Set();

// Foydalanuvchilarni yuklash
function loadUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

// Foydalanuvchini saqlash
function saveUser(chatId) {
    const users = loadUsers();
    if (!users.includes(chatId)) {
        users.push(chatId);
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    }
}

// Admin tekshirish
function isAdmin(userId) {
    return userId === ADMIN_ID;
}

// Admin uchun klaviatura
function getAdminKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [{ text: '📢 Post' }],
            ],
            resize_keyboard: true
        }
    };
}

// Post rejimidagi klaviatura
function getPostKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [{ text: '❌ Bekor qilish' }],
            ],
            resize_keyboard: true
        }
    };
}

// Barcha foydalanuvchilarga xabar yuborish (broadcast)
async function broadcast(msg) {
    const users = loadUsers();
    let success = 0;
    let fail = 0;

    for (const chatId of users) {
        try {
            if (msg.text) {
                await bot.sendMessage(chatId, msg.text);
            } else if (msg.photo) {
                const photo = msg.photo[msg.photo.length - 1].file_id;
                await bot.sendPhoto(chatId, photo, { caption: msg.caption || '' });
            } else if (msg.video) {
                await bot.sendVideo(chatId, msg.video.file_id, { caption: msg.caption || '' });
            } else if (msg.document) {
                await bot.sendDocument(chatId, msg.document.file_id, { caption: msg.caption || '' });
            } else if (msg.animation) {
                await bot.sendAnimation(chatId, msg.animation.file_id, { caption: msg.caption || '' });
            } else if (msg.sticker) {
                await bot.sendSticker(chatId, msg.sticker.file_id);
            } else if (msg.voice) {
                await bot.sendVoice(chatId, msg.voice.file_id, { caption: msg.caption || '' });
            } else if (msg.audio) {
                await bot.sendAudio(chatId, msg.audio.file_id, { caption: msg.caption || '' });
            } else if (msg.video_note) {
                await bot.sendVideoNote(chatId, msg.video_note.file_id);
            }
            success++;
        } catch (err) {
            fail++;
        }
    }

    return { success, fail };
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    // Foydalanuvchini saqlash
    saveUser(chatId);

    // Admin komandalarini tekshirish (postMode dan oldin)
    if (isAdmin(userId)) {
        // "Bekor qilish" — har doim ishlaydi, postMode ga bog'liq emas
        if (text === '❌ Bekor qilish') {
            postMode.delete(userId);
            return bot.sendMessage(chatId, "✅ Post bekor qilindi.", getAdminKeyboard());
        }

        // "Post" tugmasi
        if (text === '📢 Post') {
            postMode.add(userId);
            const users = loadUsers();
            return bot.sendMessage(chatId,
                `📢 Post rejimi yoqildi!\n\n👥 Jami foydalanuvchilar: ${users.length}\n\nPostni yuboring (matn, rasm, video, fayl).\n❌ Bekor qilish uchun tugmani bosing.`,
                getPostKeyboard()
            );
        }

        // /stats komandasi
        if (text === '/stats') {
            const users = loadUsers();
            return bot.sendMessage(chatId, `📊 Statistika:\n👥 Jami foydalanuvchilar: ${users.length}`, getAdminKeyboard());
        }

        // Post rejimida — xabarni broadcast qilish
        if (postMode.has(userId)) {
            postMode.delete(userId);
            const result = await broadcast(msg);
            return bot.sendMessage(chatId,
                `✅ Post yuborildi!\n\n📊 Natija:\n👥 Muvaffaqiyatli: ${result.success}\n❌ Xatolik: ${result.fail}`,
                getAdminKeyboard()
            );
        }
    }

    // /start komandasi
    if (text === '/start') {
        if (isAdmin(userId)) {
            return bot.sendMessage(chatId,
                "Salom Admin! 👋\nMenga Instagram, TikTok, Pinterest yoki YouTube linkini yuboring.\n\n📢 Post tugmasini bosib barcha foydalanuvchilarga xabar yuborishingiz mumkin.",
                getAdminKeyboard()
            );
        }
        return bot.sendMessage(chatId, "Salom! Menga Instagram, TikTok, Pinterest yoki YouTube linkini yuboring.");
    }

    if (!text) return;

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
                    },
                    timeout: 30000
                });

                const data = response.data;
                const caption = '<a href="https://t.me/pinterest_downloader_uzbot">pinterest_downloader_uzbot</a> dan yuklandi';

                // Media turini aniqlash funksiyasi
                function isImageFile(filename) {
                    if (!filename) return false;
                    const ext = filename.split('.').pop().toLowerCase();
                    return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
                }

                // Faylni yuklab olib, Telegramga yuborish funksiyasi
                async function downloadAndSend(fileUrl, filename, captionText) {
                    const tmpDir = path.join(__dirname, 'tmp');
                    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
                    
                    const safeName = filename || `file_${Date.now()}`;
                    const filePath = path.join(tmpDir, safeName);
                    
                    // Faylni yuklab olish
                    const fileResponse = await axios.get(fileUrl, {
                        responseType: 'stream',
                        timeout: 120000
                    });
                    
                    const writer = fs.createWriteStream(filePath);
                    fileResponse.data.pipe(writer);
                    
                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });
                    
                    // Telegramga yuborish
                    try {
                        if (isImageFile(safeName)) {
                            await bot.sendPhoto(chatId, filePath, {
                                caption: captionText,
                                parse_mode: 'HTML'
                            });
                        } else {
                            await bot.sendVideo(chatId, filePath, {
                                caption: captionText,
                                parse_mode: 'HTML'
                            });
                        }
                    } finally {
                        // Faylni o'chirish
                        try { fs.unlinkSync(filePath); } catch (e) {}
                    }
                }

                // Natija muvaffaqiyatli bo'lsa
                if (data.status === 'redirect') {
                    // Redirect — to'g'ridan-to'g'ri public URL, Telegram o'zi yuklay oladi
                    if (isImageFile(data.filename)) {
                        await bot.sendPhoto(chatId, data.url, {
                            caption: caption,
                            parse_mode: 'HTML'
                        });
                    } else {
                        await bot.sendVideo(chatId, data.url, {
                            caption: caption,
                            parse_mode: 'HTML'
                        });
                    }
                } else if (data.status === 'tunnel') {
                    // Tunnel — cobalt server orqali, avval yuklab keyin yuborish kerak
                    await downloadAndSend(data.url, data.filename, caption);
                } else if (data.status === 'picker' && data.picker) {
                    // Bir nechta rasm/video — hammasini yuborish
                    let sent = 0;
                    for (const item of data.picker) {
                        try {
                            const itemFilename = `picker_${Date.now()}_${sent}${item.type === 'photo' ? '.jpg' : '.mp4'}`;
                            const itemCaption = sent === 0 ? caption : '';
                            
                            // Picker itemlar ham tunnel orqali keladi
                            await downloadAndSend(item.url, itemFilename, itemCaption);
                            sent++;
                        } catch (itemErr) {
                            console.error("Picker item yuborishda xato:", itemErr.message);
                        }
                    }
                    if (sent === 0) {
                        bot.sendMessage(chatId, "Fayllarni yuklab olishda muammo yuzaga keldi.");
                    }
                } else {
                    console.error("Noma'lum API javobi:", JSON.stringify(data));
                    bot.sendMessage(chatId, "Faylni yuklab olishda muammo yuzaga keldi.");
                }
            } catch (error) {
                console.error("API Xatosi:", error.message);
                if (error.response) {
                    console.error("Server javobi:", JSON.stringify(error.response.data));
                }
                bot.sendMessage(chatId, "Server bilan ulanishda xatolik yuz berdi. Iltimos keyinroq qayta urinib ko'ring.");
            }
        } else {
            bot.sendMessage(chatId, "Men faqat Instagram, TikTok, Pinterest va YouTube linklarini qabul qilaman.");
        }
    } else {
        bot.sendMessage(chatId, "Iltimos, faqat link yuboring!");
    }
});

console.log('Bot ishga tushdi...');