import { NextRequest, NextResponse } from "next/server"
import { Telegraf } from "telegraf"
import { google } from "googleapis"

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const bot = new Telegraf(BOT_TOKEN)

// --- Google Calendar настройка ---
const SCOPES = ["https://www.googleapis.com/auth/calendar"]
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!

// Берём данные сервисного аккаунта из env (лучше чем хранить json)
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL!
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n")

const auth = new google.auth.JWT({
  email: GOOGLE_CLIENT_EMAIL,
  key: GOOGLE_PRIVATE_KEY,
  scopes: SCOPES
})
const calendar = google.calendar({ version: "v3", auth })

// --- Telegram handlers ---
bot.start((ctx) => {
  ctx.reply("Привет! 👋 Напиши /book, чтобы забронировать встречу")
})

bot.command("book", async (ctx) => {
  try {
    const startTime = new Date()
    startTime.setDate(startTime.getDate() + 1) // завтра
    startTime.setHours(10, 0, 0, 0)

    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000) // 30 мин

    const event = {
      summary: "Консультация",
      description: "Встреча через Telegram-бота",
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
      // attendees: [
      //   { email: process.env.OWNER_EMAIL! }, // твоя почта
      //   { email: "client@example.com" },     // потом можно спросить у юзера
      // ],
      conferenceData: {
        createRequest: { requestId: `tg-${Date.now()}` },
      },
    }

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: event,
      conferenceDataVersion: 1,
    })

    ctx.reply(
      `✅ Встреча забронирована!\nСсылка: ${response.data.hangoutLink}`
    )
  } catch (err) {
    console.error(err)
    ctx.reply("⚠️ Ошибка при бронировании")
  }
})

// --- Webhook endpoint ---
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    await bot.handleUpdate(body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("Telegram webhook error:", e)
    return NextResponse.json({ error: "failed" }, { status: 500 })
  }
}
