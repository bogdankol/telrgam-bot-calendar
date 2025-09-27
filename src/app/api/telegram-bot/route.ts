import { Telegraf, Markup } from "telegraf"
import { google } from "googleapis"
import { NextRequest, NextResponse } from 'next/server'
import { DateTime } from 'luxon'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const bot = new Telegraf(BOT_TOKEN)

// --- Google Calendar настройка ---
const SCOPES = ["https://www.googleapis.com/auth/calendar"]
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL!
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n")
const TIMEZONE = "Europe/Kiev"

const auth = new google.auth.JWT({
  email: GOOGLE_CLIENT_EMAIL,
  key: GOOGLE_PRIVATE_KEY,
  scopes: SCOPES,
})
const calendar = google.calendar({ version: "v3", auth })

// Простая сессия в памяти
const sessions = new Map<string, { startTime?: Date }>()

// --- Получение свободных слотов для примера ---
async function getAvailableSlotsForDay(day: Date) {
  const slots: { start: Date; label: string }[] = []
  const startHour = 11
  const endHour = 19
  const meetingDuration = 60
  const breakAfterMeeting = 30
  const maxMeetingsPerDay = 5

  let meetingsCount = 0
  let slotStart = new Date(day)
  slotStart.setHours(startHour, 0, 0, 0)

  while (slotStart.getHours() < endHour && meetingsCount < maxMeetingsPerDay) {
    const slotEnd = new Date(slotStart.getTime() + meetingDuration * 60 * 1000)

    const events = await calendar.events.list({
      calendarId: CALENDAR_ID!,
      timeMin: slotStart.toISOString(),
      timeMax: slotEnd.toISOString(),
      singleEvents: true,
    })

    if (!events.data.items || events.data.items.length === 0) {
      slots.push({
        start: new Date(slotStart),
        label: slotStart.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
      })
      meetingsCount++
      slotStart = new Date(slotEnd.getTime() + breakAfterMeeting * 60 * 1000)
    } else {
      slotStart = new Date(slotStart.getTime() + 30 * 60 * 1000)
    }
  }

  return slots
}

// --- Бот ---
bot.start((ctx) => {
  ctx.reply("Привет! 👋 Напиши /book, чтобы забронировать встречу.")
})

bot.command("book", async (ctx) => {
  const now = new Date()
  const slots = await getAvailableSlotsForDay(now) // Для примера берем один день
  if (slots.length === 0) return ctx.reply("Нет свободных слотов на сегодня.")

  const buttons = slots.map(s => [Markup.button.callback(s.label, `slot_${s.start.getTime()}`)])
  ctx.reply("Выберите удобное время:", Markup.inlineKeyboard(buttons))
})

// --- Выбор слота ---
bot.action(/slot_(\d+)/, (ctx) => {
  const timestamp = parseInt(ctx.match[1])
  const startTime = new Date(timestamp)
  sessions.set(String(ctx.from!.id), { startTime })

  // --- Запрос контакта через Telegram ---
  ctx.reply(
    "Пожалуйста, поделитесь своим номером телефона для подтверждения брони:",
    Markup.keyboard([Markup.button.contactRequest("Отправить контакт")])
      .oneTime()
      .resize()
  )
})

// --- Получение контакта пользователя ---
bot.on("contact", async (ctx) => {
  const userId = String(ctx.from!.id)
  const session = sessions.get(userId)
  if (!session || !session.startTime) return

  const contact = ctx.message.contact
  const phone = contact.phone_number
  const name = contact.first_name + (contact.last_name ? " " + contact.last_name : "")

  const start = DateTime.fromJSDate(session.startTime).setZone(TIMEZONE)
  const end = start.plus({ minutes: 60 })

  try {
    // --- Создание события в Google Calendar ---
    const event = {
      summary: "Консультация",
      description: `Забронировано через Telegram-бота.\nКлиент: ${name}\nТелефон: ${phone}`,
      start: { dateTime: start.toISO({ suppressMilliseconds: true }), timeZone: TIMEZONE },
      end: { dateTime: end.toISO({ suppressMilliseconds: true }), timeZone: TIMEZONE },
      conferenceData: { createRequest: { requestId: `tg-${Date.now()}` } },
    }

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID!,
      requestBody: event,
      conferenceDataVersion: 1,
    })

    await ctx.reply(
      `✅ Встреча успешно забронирована!\n` +
      `📅 Дата и время: ${session.startTime.toLocaleString("ru-RU")}\n` +
      (response.data.hangoutLink ? `🔗 Ссылка на Google Meet: ${response.data.hangoutLink}\n` : "") +
      `📞 Телефон: ${phone}\n` +
      `👤 Имя: ${name}`
    )

    sessions.delete(userId)
  } catch (err) {
    console.error("Ошибка при создании события:", err)
    await ctx.reply("⚠️ Не удалось забронировать встречу. Попробуйте позже.")
  }
})

// --- Webhook handler для Next.js ---
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
