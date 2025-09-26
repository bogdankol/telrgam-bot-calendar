import { NextRequest, NextResponse } from "next/server";
import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Простая команда для проверки
bot.start((ctx) => ctx.reply("Бот работает ✅"));

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Передаём апдейт в Telegraf
    await bot.handleUpdate(body);

    // Telegram требует ответ 200 OK
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram webhook error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// Если Telegram случайно сделает GET, вернём 200, чтобы не было 405
export async function GET() {
  return NextResponse.json({ ok: true, message: "Telegram bot is running" });
}
