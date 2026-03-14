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

// ==================== FOYDALANUVCHILAR BOSHQARUVI ====================

// Foydalanuvchilarni yuklash (avtomatik migratsiya bilan)
function loadUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        const parsed = JSON.parse(data);

        // Eski formatdan yangi formatga migratsiya: [123] → [{id: 123, status: "active"}]
        if (parsed.length > 0 && typeof parsed[0] === 'number') {
            const migrated = parsed.map(id => ({ id, status: 'active' }));
            fs.writeFileSync(USERS_FILE, JSON.stringify(migrated, null, 2));
            console.log(`✅ ${migrated.length} ta foydalanuvchi yangi formatga migrate qilindi.`);
            return migrated;
        }

        return parsed;
    } catch (err) {
        return [];
    }
}

// Foydalanuvchini saqlash (yangi format)
function saveUser(chatId) {
    const users = loadUsers();
    const existing = users.find(u => u.id === chatId);
    if (!existing) {
        users.push({ id: chatId, status: 'active' });
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } else if (existing.status === 'blocked') {
        // Agar oldin bloklagan bo'lsa va endi qayta yozsa — active qilish
        existing.status = 'active';
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    }
}

// Foydalanuvchi statusini yangilash
function updateUserStatus(chatId, status) {
    const users = loadUsers();
    const user = users.find(u => u.id === chatId);
    if (user) {
        user.status = status;
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    }
}

// Statistikani olish
function getStats() {
    const users = loadUsers();
    const total = users.length;
    const active = users.filter(u => u.status === 'active').length;
    const blocked = users.filter(u => u.status === 'blocked').length;
    return { total, active, blocked };
}

// ==================== ADMIN FUNKSIYALARI ====================

// Admin tekshirish
function isAdmin(userId) {
    return userId === ADMIN_ID;
}

// Admin uchun klaviatura
function getAdminKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [{ text: '📢 Post' }, { text: '📊 Statistika' }],
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

// Barcha faol foydalanuvchilarga xabar yuborish (broadcast)
async function broadcast(msg) {
    const users = loadUsers();
    const activeUsers = users.filter(u => u.status === 'active');
    let success = 0;
    let fail = 0;
    let newBlocked = 0;

    for (const user of activeUsers) {
        try {
            if (msg.text) {
                await bot.sendMessage(user.id, msg.text);
            } else if (msg.photo) {
                const photo = msg.photo[msg.photo.length - 1].file_id;
                await bot.sendPhoto(user.id, photo, { caption: msg.caption || '' });
            } else if (msg.video) {
                await bot.sendVideo(user.id, msg.video.file_id, { caption: msg.caption || '' });
            } else if (msg.document) {
                await bot.sendDocument(user.id, msg.document.file_id, { caption: msg.caption || '' });
            } else if (msg.animation) {
                await bot.sendAnimation(user.id, msg.animation.file_id, { caption: msg.caption || '' });
            } else if (msg.sticker) {
                await bot.sendSticker(user.id, msg.sticker.file_id);
            } else if (msg.voice) {
                await bot.sendVoice(user.id, msg.voice.file_id, { caption: msg.caption || '' });
            } else if (msg.audio) {
                await bot.sendAudio(user.id, msg.audio.file_id, { caption: msg.caption || '' });
            } else if (msg.video_note) {
                await bot.sendVideoNote(user.id, msg.video_note.file_id);
            }
            success++;
        } catch (err) {
            fail++;
            // 403 Forbidden — foydalanuvchi botni bloklagan
            if (err.response && err.response.statusCode === 403) {
                updateUserStatus(user.id, 'blocked');
                newBlocked++;
            }
        }
    }

    return { success, fail, newBlocked };
}

// Matn broadcast (faqat /send uchun)
async function broadcastText(text) {
    const users = loadUsers();
    const activeUsers = users.filter(u => u.status === 'active');
    let success = 0;
    let fail = 0;
    let newBlocked = 0;

    for (const user of activeUsers) {
        try {
            await bot.sendMessage(user.id, text, { parse_mode: 'HTML' });
            success++;
        } catch (err) {
            fail++;
            if (err.response && err.response.statusCode === 403) {
                updateUserStatus(user.id, 'blocked');
                newBlocked++;
            }
        }
    }

    return { success, fail, newBlocked };
}

// ==================== MEDIA YORDAMCHI FUNKSIYALAR ====================

// Media turini aniqlash
function isImageFile(filename) {
    if (!filename) return false;
    const ext = filename.split('.').pop().toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
}

// Faylni yuklab olib, Telegramga yuborish
async function downloadAndSend(chatId, fileUrl, filename, captionText) {
    const tmpDir = path.join(__dirname, 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    let safeName = filename || `file_${Date.now()}`;
    
    // Telegram videolarni hujjat (fayl) emas, video sifatida ko'rishi uchun .mp4 qo'shamiz
    if (!isImageFile(safeName) && !safeName.match(/\.(mp4|webm|mov|mkv)$/i)) {
        safeName += '.mp4';
    }

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

// ==================== BOT XABAR HANDLER ====================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    // Foydalanuvchini saqlash
    saveUser(chatId);

    // ---- ADMIN KOMANDALAR ----
    if (isAdmin(userId)) {
        // "Bekor qilish" — har doim ishlaydi
        if (text === '❌ Bekor qilish') {
            postMode.delete(userId);
            return bot.sendMessage(chatId, "✅ Post bekor qilindi.", getAdminKeyboard());
        }

        // "📊 Statistika" tugmasi yoki /stat komandasi
        if (text === '📊 Statistika' || text === '/stat' || text === '/stats') {
            const stats = getStats();
            return bot.sendMessage(chatId,
                `📊 Statistika:\n\n👥 Jami: ${stats.total}\n✅ Faol: ${stats.active}\n🚫 Bloklagan: ${stats.blocked}`,
                getAdminKeyboard()
            );
        }

        // /send komandasi
        if (text && text.startsWith('/send ')) {
            const sendText = text.slice(6).trim();
            if (!sendText) {
                return bot.sendMessage(chatId, "❌ Matn kiriting: /send [matn]", getAdminKeyboard());
            }
            const statusMsg = await bot.sendMessage(chatId, "📤 Xabar tarqatilmoqda...");
            const result = await broadcastText(sendText);
            await bot.editMessageText(
                `✅ Xabar tarqatildi!\n\n📊 Natija:\n✅ Muvaffaqiyatli: ${result.success}\n❌ Xatolik: ${result.fail}\n🚫 Yangi bloklagan: ${result.newBlocked}`,
                { chat_id: chatId, message_id: statusMsg.message_id }
            );
            return;
        }

        // "📢 Post" tugmasi
        if (text === '📢 Post') {
            postMode.add(userId);
            const stats = getStats();
            return bot.sendMessage(chatId,
                `📢 Post rejimi yoqildi!\n\n👥 Faol foydalanuvchilar: ${stats.active}\n🚫 Bloklagan: ${stats.blocked}\n\nPostni yuboring (matn, rasm, video, fayl).\n❌ Bekor qilish uchun tugmani bosing.`,
                getPostKeyboard()
            );
        }

        // Post rejimida — xabarni broadcast qilish
        if (postMode.has(userId)) {
            postMode.delete(userId);
            const statusMsg = await bot.sendMessage(chatId, "📤 Post tarqatilmoqda...");
            const result = await broadcast(msg);
            await bot.editMessageText(
                `✅ Post yuborildi!\n\n📊 Natija:\n✅ Muvaffaqiyatli: ${result.success}\n❌ Xatolik: ${result.fail}\n🚫 Yangi bloklagan: ${result.newBlocked}`,
                { chat_id: chatId, message_id: statusMsg.message_id }
            );
            return bot.sendMessage(chatId, "Davom eting:", getAdminKeyboard());
        }
    }

    // ---- /start KOMANDASI ----
    if (text === '/start') {
        if (isAdmin(userId)) {
            return bot.sendMessage(chatId,
                "Salom Admin! 👋\nMenga Instagram, TikTok, Pinterest yoki YouTube linkini yuboring.\n\n📢 Post — barcha foydalanuvchilarga xabar\n📊 Statistika — foydalanuvchilar soni\n/send [matn] — matn tarqatish",
                getAdminKeyboard()
            );
        }
        return bot.sendMessage(chatId, "Salom! Menga Instagram, TikTok, Pinterest yoki YouTube linkini yuboring.");
    }

    if (!text) return;

    // ---- LINK QAYTA ISHLASH ----
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

                // Natija muvaffaqiyatli bo'lsa
                if (data.status === 'redirect' || data.status === 'tunnel') {
                    if (isImageFile(data.filename)) {
                        // Rasmlar — to'g'ridan-to'g'ri URL orqali yuborish
                        try {
                            await bot.sendPhoto(chatId, data.url, {
                                caption: caption,
                                parse_mode: 'HTML'
                            });
                        } catch (directErr) {
                            console.error("URL orqali yuborishda xato, yuklab yuborilmoqda:", directErr.message);
                            await downloadAndSend(chatId, data.url, data.filename, caption);
                        }
                    } else {
                        // Videolar — har doim yuklab keyin yuborish
                        await downloadAndSend(chatId, data.url, data.filename, caption);
                    }
                } else if (data.status === 'picker' && data.picker) {
                    // Bir nechta rasm/video — hammasini yuklab olib, media group qilib yuborish
                    const tmpDir = path.join(__dirname, 'tmp');
                    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

                    const downloadedFiles = [];

                    for (let i = 0; i < data.picker.length; i++) {
                        const item = data.picker[i];
                        try {
                            const ext = item.type === 'photo' ? '.jpg' : '.mp4';
                            const itemFilename = `picker_${Date.now()}_${i}${ext}`;
                            const filePath = path.join(tmpDir, itemFilename);

                            const fileResponse = await axios.get(item.url, {
                                responseType: 'stream',
                                timeout: 120000
                            });

                            const writer = fs.createWriteStream(filePath);
                            fileResponse.data.pipe(writer);

                            await new Promise((resolve, reject) => {
                                writer.on('finish', resolve);
                                writer.on('error', reject);
                            });

                            downloadedFiles.push({
                                path: filePath,
                                type: item.type,
                                filename: itemFilename
                            });
                        } catch (itemErr) {
                            console.error("Picker item yuklashda xato:", itemErr.message);
                        }
                    }

                    if (downloadedFiles.length === 0) {
                        bot.sendMessage(chatId, "Fayllarni yuklab olishda muammo yuzaga keldi.");
                    } else if (downloadedFiles.length === 1) {
                        // Bitta fayl bo'lsa oddiy yuborish
                        try {
                            const file = downloadedFiles[0];
                            if (isImageFile(file.filename)) {
                                await bot.sendPhoto(chatId, file.path, {
                                    caption: caption,
                                    parse_mode: 'HTML'
                                });
                            } else {
                                await bot.sendVideo(chatId, file.path, {
                                    caption: caption,
                                    parse_mode: 'HTML'
                                });
                            }
                        } catch (e) {
                            console.error("Bitta fayl yuborishda xato:", e.message);
                        }
                        try { fs.unlinkSync(downloadedFiles[0].path); } catch (e) {}
                    } else {
                        // Bir nechta fayl — media group qilib yuborish
                        try {
                            const mediaGroup = downloadedFiles.map((file, idx) => {
                                const isImage = isImageFile(file.filename);
                                return {
                                    type: isImage ? 'photo' : 'video',
                                    media: file.path,
                                    caption: idx === 0 ? caption : '',
                                    parse_mode: idx === 0 ? 'HTML' : undefined
                                };
                            });

                            await bot.sendMediaGroup(chatId, mediaGroup);
                        } catch (groupErr) {
                            console.error("Media group yuborishda xato:", groupErr.message);
                            // Fallback — bittadan yuborish
                            for (let i = 0; i < downloadedFiles.length; i++) {
                                try {
                                    const file = downloadedFiles[i];
                                    if (isImageFile(file.filename)) {
                                        await bot.sendPhoto(chatId, file.path, {
                                            caption: i === 0 ? caption : '',
                                            parse_mode: 'HTML'
                                        });
                                    } else {
                                        await bot.sendVideo(chatId, file.path, {
                                            caption: i === 0 ? caption : '',
                                            parse_mode: 'HTML'
                                        });
                                    }
                                } catch (fallbackErr) {
                                    console.error("Fallback yuborishda xato:", fallbackErr.message);
                                }
                            }
                        }

                        // Barcha temp fayllarni o'chirish
                        for (const file of downloadedFiles) {
                            try { fs.unlinkSync(file.path); } catch (e) {}
                        }
                    }
                } else {
                    console.error("Noma'lum API javobi:", JSON.stringify(data));
                    bot.sendMessage(chatId, "Faylni yuklab olishda muammo yuzaga keldi.");
                }
            } catch (error) {
                console.error("API Xatosi:", error.message);
                if (error.response) {
                    console.error("Server javobi:", JSON.stringify(error.response.data));
                    const errCode = error.response.data?.error?.code;
                    if (errCode === 'error.api.fetch.empty') {
                        bot.sendMessage(chatId, "Bu kontentni yuklab bo'lmadi. Link yopiq yoki noto'g'ri bo'lishi mumkin.");
                    } else {
                        bot.sendMessage(chatId, "Faylni yuklab olishda xatolik yuz berdi. Iltimos keyinroq qayta urinib ko'ring.");
                    }
                } else {
                    bot.sendMessage(chatId, "Server bilan ulanishda xatolik yuz berdi. Iltimos keyinroq qayta urinib ko'ring.");
                }
            }
        } else {
            bot.sendMessage(chatId, "Men faqat Instagram, TikTok, Pinterest va YouTube linklarini qabul qilaman.");
        }
    } else {
        bot.sendMessage(chatId, "Iltimos, faqat link yuboring!");
    }
});

console.log('Bot ishga tushdi...');