import { Telegraf, Markup } from "telegraf"
import { google } from "googleapis"
import { NextRequest, NextResponse } from 'next/server'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const bot = new Telegraf(BOT_TOKEN)

// --- Google Calendar настройка ---
const SCOPES = ["https://www.googleapis.com/auth/calendar"] // 🔥 УБРАЛ ЛИШНИЙ ПРОБЕЛ!
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!
// const OWNER_EMAIL = process.env.OWNER_EMAIL!

// Берём данные сервисного аккаунта из env
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL!
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n")

const auth = new google.auth.JWT({
  email: GOOGLE_CLIENT_EMAIL,
  key: GOOGLE_PRIVATE_KEY,
  scopes: SCOPES,
})
const calendar = google.calendar({ version: "v3", auth })

// Простая "сессия" в памяти (для demo; в продакшене — Redis или БД)
const sessions = new Map<string, { startTime?: Date }>()

// Генерация ближайших слотов (завтра с 9:00 до 18:00 с шагом 30 мин)
function generateTimeSlots(): { date: Date; label: string }[] {
  const slots = []
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0) // Начинаем с 9:00

  for (let i = 0; i < 18; i++) { // 9:00–18:00 → 18 слотов
    const slot = new Date(tomorrow.getTime() + i * 30 * 60 * 1000)
    // Пропускаем прошедшие (на случай, если сейчас уже поздно)
    if (slot > now) {
      slots.push({
        date: slot,
        label: slot.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
      })
    }
  }
  return slots.slice(0, 5) // Показываем первые 5 свободных слотов
}

bot.start((ctx) => {
  ctx.reply("Привет! 👋 Напиши /book, чтобы забронировать встречу.")
})

bot.command("book", (ctx) => {
  const slots = generateTimeSlots()
  if (slots.length === 0) {
    return ctx.reply("К сожалению, нет доступных слотов на ближайшее время.")
  }

  const buttons = slots.map(slot => [
    Markup.button.callback(
      `${slot.label}, ${slot.date.toLocaleDateString("ru-RU")}`,
      `select_${slot.date.getTime()}`
    )
  ])

  ctx.reply("Выберите удобное время:", Markup.inlineKeyboard(buttons))
})

bot.action(/select_(\d+)/, (ctx) => {
  const timestamp = parseInt(ctx.match[1])
  const startTime = new Date(timestamp)

  sessions.set(String(ctx.from!.id), { startTime })

  ctx.replyWithMarkdown(
    `Вы выбрали: *${startTime.toLocaleString("ru-RU")}*\n\n` +
    "Пожалуйста, введите ваш email для подтверждения бронирования:"
  )
})

bot.on("text", async (ctx) => {
  const userId = String(ctx.from!.id)
  const session = sessions.get(userId)
  if (!session || !session.startTime) return

  const email = ctx.message.text.trim()
  if (!/^[\w.-]+@[\w.-]+\.\w+$/.test(email)) {
    return ctx.reply("❌ Неверный формат email. Попробуйте снова:")
  }

  const endTime = new Date(session.startTime.getTime() + 30 * 60 * 1000)

  try {
    const event = {
      summary: "Консультация",
      description: `Забронировано через Telegram-бота.\nEmail клиента: ${email}`,
      start: {
        dateTime: session.startTime.toISOString(),
        timeZone: "Europe/Kiev", // 🔥 УКАЖИТЕ СВОЙ ЧАСОВОЙ ПОЯС!
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: "Europe/Kiev",
      },
      // attendees: [
      //   { email: OWNER_EMAIL! },
      //   { email },
      // ],
      conferenceData: {
        createRequest: { requestId: `tg-${Date.now()}` },
      },
    }

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID!,
      requestBody: event,
      conferenceDataVersion: 1,
    })

    await ctx.reply(
      `✅ Встреча успешно забронирована!\n\n` +
      `📅 Дата и время: ${session.startTime.toLocaleString("ru-RU")}\n` +
      (response.data.hangoutLink
        ? `🔗 Ссылка на Google Meet: ${response.data.hangoutLink}\n`
        : `ℹ️ Ссылка появится в приглашении.\n`) +
      `📧 Приглашение отправлено на ${email}.`
    )

    sessions.delete(userId)
  } catch (err) {
    console.error("Ошибка при создании события:", err)
    await ctx.reply("⚠️ Не удалось забронировать встречу. Попробуйте позже.")
  }
})

// Webhook handler
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    await bot.handleUpdate(body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Telegram webhook error:", err)
    return NextResponse.json({ error: "failed" }, { status: 500 })
  }
}