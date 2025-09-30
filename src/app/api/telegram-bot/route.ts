import { Telegraf, Markup } from "telegraf"
import { google } from "googleapis"
import { NextRequest, NextResponse } from "next/server"
import { DateTime } from "luxon"

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

// Простая "сессия" в памяти
const sessions = new Map<
  string,
  { startTime?: Date; phone?: string; name?: string; email?: string }
>()

// --- Получение доступных дней ---
async function getAvailableDays(daysAhead = 30, minDays = 10) {
  const now = new Date()
  const availableDays: Date[] = []

  for (let i = 1; i <= daysAhead; i++) {
    const day = new Date(now)
    day.setDate(now.getDate() + i)

    const dayOfWeek = day.getDay()
    if (dayOfWeek === 0 || dayOfWeek === 6) continue

    const slots = await getAvailableSlotsForDay(day)

    if (slots.length > 0 || availableDays.length < minDays) {
      availableDays.push(day)
    }

    if (availableDays.length >= minDays) break
  }

  return availableDays
}

// --- Получение слотов ---
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

  while (meetingsCount < maxMeetingsPerDay) {
    const slotEnd = new Date(slotStart.getTime() + meetingDuration * 60 * 1000)

    if (slotEnd.getHours() >= endHour && slotEnd.getMinutes() > 0) break

    const events = await calendar.events.list({
      calendarId: CALENDAR_ID!,
      timeMin: slotStart.toISOString(),
      timeMax: slotEnd.toISOString(),
      singleEvents: true,
    })

    if (!events.data.items || events.data.items.length === 0) {
      slots.push({
        start: new Date(slotStart),
        label: slotStart.toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      })

      meetingsCount++
      slotStart = new Date(slotEnd.getTime() + breakAfterMeeting * 60 * 1000)
    } else {
      slotStart = new Date(
        slotStart.getTime() + (meetingDuration + breakAfterMeeting) * 60 * 1000
      )
    }
  }

  return slots
}

// --- Команды бота ---
bot.start((ctx) => {
  ctx.reply("Привет! 👋 Напиши /book, чтобы забронировать встречу.")
})

bot.command("book", async (ctx) => {
  const days = await getAvailableDays(30)
  const buttons = days.map((d) => [
    Markup.button.callback(d.toLocaleDateString("ru-RU"), `day_${d.toISOString()}`),
  ])
  ctx.reply("Выберите день для встречи:", Markup.inlineKeyboard(buttons))
})

// --- Выбор дня ---
bot.action(/day_(.+)/, async (ctx) => {
  const day = new Date(ctx.match[1])
  const slots = await getAvailableSlotsForDay(day)
  if (slots.length === 0) return ctx.reply("Нет доступных слотов на этот день.")

  const buttons = slots.map((s) => [
    Markup.button.callback(s.label, `slot_${s.start.getTime()}`),
  ])
  ctx.reply("Выберите удобное время:", Markup.inlineKeyboard(buttons))
})

// --- Выбор слота и запрос контакта ---
bot.action(/slot_(\d+)/, (ctx) => {
  const timestamp = parseInt(ctx.match[1])
  const startTime = new Date(timestamp)
  sessions.set(String(ctx.from!.id), { startTime })

  ctx.reply(
    "Пожалуйста, поделитесь своим номером телефона для подтверждения брони:",
    Markup.keyboard([Markup.button.contactRequest("📱 Отправить контакт")])
      .oneTime()
      .resize()
  )
})

// --- Получение контакта ---
bot.on("contact", (ctx) => {
  const userId = String(ctx.from!.id)
  const session = sessions.get(userId)
  if (!session || !session.startTime) return

  const contact = ctx.message.contact
  session.phone = contact.phone_number
  session.name =
    contact.first_name + (contact.last_name ? " " + contact.last_name : "")
  sessions.set(userId, session)

  ctx.reply("Спасибо! Теперь введите ваш email для подтверждения брони:")
})

// --- Обработка email и создание события ---
bot.on("text", async (ctx) => {
  const userId = String(ctx.from!.id)
  const session = sessions.get(userId)
  if (!session || !session.startTime || !session.phone) return // ждем контакт

  const email = ctx.message.text.trim()
  if (!/^[\w.-]+@[\w.-]+\.\w+$/.test(email)) {
    return ctx.reply("❌ Неверный формат email. Попробуйте снова:")
  }

  session.email = email
  sessions.set(userId, session)

  const start = DateTime.fromJSDate(session.startTime).setZone(TIMEZONE)
  const end = start.plus({ minutes: 60 })

  try {
    const event = {
      summary: "Консультация",
      description: `Забронировано через Telegram-бота.\nКлиент: ${session.name}\nТелефон: ${session.phone}\nEmail: ${session.email}\n💰 Статус оплаты: НЕ оплачено`,
      start: { dateTime: start.toISO({ suppressMilliseconds: true }), timeZone: TIMEZONE },
      end: { dateTime: end.toISO({ suppressMilliseconds: true }), timeZone: TIMEZONE },
      conferenceData: { createRequest: { requestId: `tg-${Date.now()}` } },
    }

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID!,
      requestBody: event,
      conferenceDataVersion: 1,
    })

    // --- Ссылка на оплату (пример для Monobank Invoice) ---
    const paymentLink = `https://send.monobank.ua/jar/XXXXXXXXX` // вставь свою ссылку
    const amount = 800

    await ctx.reply(
      `✅ Встреча забронирована!\n` +
        `📅 Дата и время: ${session.startTime.toLocaleString("ru-RU")}\n` +
        (response.data.hangoutLink
          ? `🔗 Ссылка на Google Meet: ${response.data.hangoutLink}\n`
          : `ℹ️ Ссылка появится в приглашении.\n`) +
        `📞 Телефон: ${session.phone}\n` +
        `👤 Имя: ${session.name}\n` +
        `📧 Email: ${session.email}\n\n` +
        `💰 Статус оплаты: ❌ НЕ оплачено\n` +
        `Сумма: ${amount} грн\n` +
        `👉 [Оплатить](${paymentLink})`,
      { parse_mode: "Markdown" }
    )

    sessions.delete(userId)
  } catch (err) {
    console.error("Ошибка при создании события:", err)
    await ctx.reply("⚠️ Не удалось забронировать встречу. Попробуйте позже.")
  }
})

// --- Webhook handler ---
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
