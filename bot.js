const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const unzipper = require("unzipper");

const BOT_TOKEN = "7789045134:AAHXFSK_DRB369eCPFWzNj2L9c9t9ba_3e8";
const REQUIRED_CHANNEL = "@k_store_hosting_offc";
const DEFAULT_BRANCH = "main";
const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const WELCOME_IMAGE = "https://img2.pixhost.to/images/5880/697358244_image.jpg";

const bot = new Telegraf(BOT_TOKEN);
const userState = {};

async function isJoined(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
}

async function sendMainMenu(ctx) {
  const uid = ctx.from.id.toString();
  userState[uid] = { step: "ask_username" };

  await ctx.replyWithPhoto(
    { url: WELCOME_IMAGE },
    {
      caption: `🚀 *GitHub Uploader Bot*

Bot ini membantu kamu upload project ZIP ke repository GitHub dengan cepat dan rapi.

*Informasi Upload*
├ Batas ukuran file: *${MAX_FILE_SIZE_MB} MB*
├ Format upload: *ZIP*
└ Mendukung semua isi project di dalam ZIP, termasuk:
  • \`package.json\`
  • \`vercel.json\`
  • source code
  • assets
  • config file
  • file kecil maupun besar selama masih dalam batas ukuran

Silakan kirim *username GitHub* kamu untuk memulai.`,
      parse_mode: "Markdown",
    }
  );
}

bot.start(async (ctx) => {
  const uid = ctx.from.id.toString();
  const joined = await isJoined(ctx, uid);

  if (!joined) {
    const msg = await ctx.replyWithPhoto(
      { url: WELCOME_IMAGE },
      {
        caption: `📢 *Akses Bot Terkunci*

Sebelum menggunakan bot ini, kamu wajib follow channel kami terlebih dahulu.

*Langkah Akses*
1. Klik tombol *Follow Channel*
2. Setelah join, tekan *Cek Follow*
3. Jika valid, bot akan langsung dibuka

Pastikan akun Telegram kamu benar-benar sudah join ke channel.`,
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.url("📢 Follow Channel", "https://t.me/Piantechinfo")],
          [Markup.button.callback("✅ Cek Follow", "cek_follow")],
        ]),
      }
    );
    userState[uid] = { gateMsg: msg.message_id };
    return;
  }

  await sendMainMenu(ctx);
});

bot.action("cek_follow", async (ctx) => {
  const uid = ctx.from.id.toString();
  const joined = await isJoined(ctx, uid);

  if (!joined) return ctx.answerCbQuery("❌ Kamu belum follow channel.");

  try {
    if (userState[uid]?.gateMsg) {
      await ctx.deleteMessage(userState[uid].gateMsg);
    }
  } catch {}

  await ctx.answerCbQuery("✅ Akses berhasil dibuka.");
  await sendMainMenu(ctx);
});

bot.on("text", async (ctx) => {
  const uid = ctx.from.id.toString();
  if (!userState[uid]) return;

  const state = userState[uid];
  const text = ctx.message.text.trim();

  if (state.step === "ask_username") {
    state.username = text;
    state.step = "ask_repo";
    return ctx.reply(`📁 Sekarang masukkan *nama repository GitHub* kamu.`, {
      parse_mode: "Markdown",
    });
  }

  if (state.step === "ask_repo") {
    state.repo = text;
    state.step = "ask_token";
    return ctx.reply(
      `🔑 Sekarang masukkan *GitHub Token* kamu.

*Token yang didukung*
• Classic PAT
• Fine-grained PAT
• OAuth Token

Pastikan token memiliki akses ke repository tujuan.`,
      { parse_mode: "Markdown" }
    );
  }

  if (state.step === "ask_token") {
    state.token = text;
    state.step = "ask_zip";

    try {
      await ctx.deleteMessage(ctx.message.message_id);
    } catch {}

    return ctx.reply(
      `✅ Token berhasil diterima.

📦 Sekarang kirim file *ZIP* project kamu.

*Catatan Upload*
├ Maksimal ukuran: *${MAX_FILE_SIZE_MB} MB*
├ Semua isi project di dalam ZIP akan ikut diproses
└ Mendukung file seperti \`package.json\`, \`vercel.json\`, config, source, assets, dan file project lainnya`,
      { parse_mode: "Markdown" }
    );
  }
});

bot.on("document", async (ctx) => {
  const uid = ctx.from.id.toString();
  const state = userState[uid];
  if (!state || state.step !== "ask_zip") return;

  const doc = ctx.message.document;

  if (!doc.file_name.toLowerCase().endsWith(".zip")) {
    return ctx.reply(`❌ File yang dikirim harus berformat *ZIP* dengan ekstensi \`.zip\`.`, {
      parse_mode: "Markdown",
    });
  }

  if (doc.file_size && doc.file_size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (doc.file_size / 1024 / 1024).toFixed(2);
    userState[uid] = null;
    return ctx.reply(
      `❌ *Upload ditolak*

Ukuran file kamu: *${sizeMB} MB*
Batas maksimal: *${MAX_FILE_SIZE_MB} MB*

Silakan kompres ulang project kamu lalu kirim kembali.
Ketik /start untuk memulai ulang proses.`,
      { parse_mode: "Markdown" }
    );
  }

  const zipPath = path.join(__dirname, `${uid}_upload.zip`);
  const extractDir = path.join(__dirname, `repo_${uid}`);

  const processingMsg = await ctx.reply(`⏳ File ZIP sedang diproses, mohon tunggu...`);

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const res = await fetch(fileLink.href);
    if (!res.ok) throw new Error("Gagal download file dari Telegram.");
    const buf = Buffer.from(await res.arrayBuffer());

    if (buf.byteLength > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (buf.byteLength / 1024 / 1024).toFixed(2);
      userState[uid] = null;
      return ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        `❌ *Upload dibatalkan*

Ukuran file setelah diproses: *${sizeMB} MB*
Batas maksimal: *${MAX_FILE_SIZE_MB} MB*`,
        { parse_mode: "Markdown" }
      );
    }

    fs.writeFileSync(zipPath, buf);

    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(extractDir, { recursive: true });

    await new Promise((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: extractDir }))
        .on("close", resolve)
        .on("error", reject);
    });

    const entries = fs.readdirSync(extractDir);
    let workDir = extractDir;
    if (entries.length === 1) {
      const singleEntry = path.join(extractDir, entries[0]);
      if (fs.statSync(singleEntry).isDirectory()) {
        workDir = singleEntry;
      }
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      processingMsg.message_id,
      null,
      `📤 Project sedang diupload ke GitHub...`
    );

    const token = state.token.trim();
    const remoteUrl = `https://oauth2:${token}@github.com/${state.username}/${state.repo}.git`;

    const gitEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "GitHub Uploader Bot",
      GIT_AUTHOR_EMAIL: "bot@upload.local",
      GIT_COMMITTER_NAME: "GitHub Uploader Bot",
      GIT_COMMITTER_EMAIL: "bot@upload.local",
    };

    const execOpts = { cwd: workDir, env: gitEnv, stdio: "pipe" };

    const gitDir = path.join(workDir, ".git");
    if (fs.existsSync(gitDir)) {
      fs.rmSync(gitDir, { recursive: true, force: true });
    }

    const gitignorePath = path.join(workDir, ".gitignore");
    let gitignoreBackup = null;
    if (fs.existsSync(gitignorePath)) {
      gitignoreBackup = fs.readFileSync(gitignorePath, "utf8");
      fs.unlinkSync(gitignorePath);
    }

    execSync("git init", execOpts);
    execSync(`git checkout -b ${DEFAULT_BRANCH}`, execOpts);
    execSync("git add -A --force", execOpts);

    if (gitignoreBackup !== null) {
      fs.writeFileSync(gitignorePath, gitignoreBackup, "utf8");
      execSync("git add .gitignore --force", execOpts);
    }

    execSync(`git commit -m "upload via bot"`, execOpts);
    execSync(`git remote add origin "${remoteUrl}"`, execOpts);
    execSync(`git push -u origin ${DEFAULT_BRANCH} --force`, execOpts);

    let fileCount = 0;
    try {
      const countOutput = execSync("git ls-files | wc -l", execOpts).toString().trim();
      fileCount = parseInt(countOutput) || 0;
    } catch {}

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      processingMsg.message_id,
      null,
      `✅ *Upload berhasil*

🌐 Repository:
https://github.com/${state.username}/${state.repo}

*Detail Upload*
├ Branch: \`${DEFAULT_BRANCH}\`
└ Total file terupload: *${fileCount} file*

Project berhasil dipush ke GitHub.`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error(e);
    let errMsg = `❌ *Upload gagal*

`;
    const errStr = e.stderr?.toString() || e.message || "";

    if (errStr.includes("Authentication failed") || errStr.includes("401")) {
      errMsg += `Token tidak valid atau token tidak memiliki akses ke repository tujuan.`;
    } else if (errStr.includes("Repository not found") || errStr.includes("404")) {
      errMsg += `Repository tidak ditemukan. Pastikan username dan nama repo benar, serta repo sudah dibuat di GitHub.`;
    } else if (errStr.includes("already exists")) {
      errMsg += `Branch sudah ada. Silakan cek repository GitHub kamu lalu coba ulang kembali.`;
    } else {
      errMsg += `Silakan cek kembali username GitHub, nama repository, dan token yang kamu gunakan.`;
    }

    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        errMsg,
        { parse_mode: "Markdown" }
      );
    } catch {
      await ctx.reply(errMsg, { parse_mode: "Markdown" });
    }
  } finally {
    try {
      fs.unlinkSync(zipPath);
    } catch {}
    try {
      fs.rmSync(extractDir, { recursive: true, force: true });
    } catch {}
    userState[uid] = null;
  }
});

bot.launch();
console.log("Piantech GitHub Uploader Bot running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
