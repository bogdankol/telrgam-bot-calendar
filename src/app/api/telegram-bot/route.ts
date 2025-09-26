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
  scopes: SCOPES,
})
const calendar = google.calendar({ version: "v3", auth })

// Простая "сессия" в памяти (для demo)
const sessions = new Map<string, { startTime?: Date }>()

bot.command("book", (ctx) => {
  // Для простоты сразу предлагаем одно время
  const startTime = new Date()
  startTime.setDate(startTime.getDate() + 1)
  startTime.setHours(10, 0, 0, 0)

  sessions.set(String(ctx.from!.id), { startTime })
  ctx.reply(
    `Вы выбрали время: ${startTime.toLocaleString("ru-RU")}\n` +
      "Введите ваш e-mail для подтверждения брони:"
  )
})

bot.on("text", async (ctx) => {
  const session = sessions.get(String(ctx.from!.id))
  if (!session || !session.startTime) return

  const email = ctx.message.text.trim()
  if (!/^[\w.-]+@[\w.-]+\.\w+$/.test(email)) {
    return ctx.reply("❌ Неверный формат e-mail, попробуйте снова:")
  }

  const endTime = new Date(session.startTime.getTime() + 30 * 60 * 1000)

  try {
    const event = {
      summary: "Консультация",
      description: `Бронирование через Telegram-бота.\nEmail клиента: ${email}`,
      start: { dateTime: session.startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
      conferenceData: { createRequest: { requestId: `tg-${Date.now()}` } },
    }

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID!,
      requestBody: event,
      conferenceDataVersion: 1,
    })

    ctx.reply(
      `✅ Встреча забронирована!\n` +
        `📅 Дата: ${session.startTime.toLocaleString("ru-RU")}\n` +
        `🔗 Ссылка на Google Meet: ${response.data.hangoutLink}\n` +
        `📩 Приглашение будет отправлено позже.`
    )
    sessions.delete(String(ctx.from!.id))
  } catch (err) {
    console.error(err)
    ctx.reply("⚠️ Ошибка при бронировании")
  }
})
