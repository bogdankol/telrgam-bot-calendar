import { Telegraf, Markup } from "telegraf"
import { google } from "googleapis"
import { NextRequest, NextResponse } from 'next/server'
import { DateTime } from 'luxon'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const bot = new Telegraf(BOT_TOKEN)

// --- Google Calendar настройка ---
const SCOPES = ["https://www.googleapis.com/auth/calendar"] // 🔥 УБРАЛ ЛИШНИЙ ПРОБЕЛ!
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!
// const OWNER_EMAIL = process.env.OWNER_EMAIL!

// Берём данные сервисного аккаунта из env
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL!
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n")
const TIMEZONE = "Europe/Kiev"

const auth = new google.auth.JWT({
  email: GOOGLE_CLIENT_EMAIL,
  key: GOOGLE_PRIVATE_KEY,
  scopes: SCOPES,
})
const calendar = google.calendar({ version: "v3", auth })

// Простая "сессия" в памяти (для demo; в продакшене — Redis или БД)
const sessions = new Map<string, { startTime?: Date }>()

// --- Получение доступных дней с пропуском выходных ---
async function getAvailableDays(daysAhead = 30, minDays = 10) {
  const now = new Date()
  const availableDays: Date[] = []

  // крутим до daysAhead дней вперёд
  for (let i = 1; i <= daysAhead; i++) {
    const day = new Date(now)
    day.setDate(now.getDate() + i)

    const dayOfWeek = day.getDay() // 0 - воскресенье, 6 - суббота
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue // пропускаем выходные
    }

    // проверяем слоты
    const slots = await getAvailableSlotsForDay(day)

    // добавляем день только если есть свободные слоты
    if (slots.length > 0) {
      availableDays.push(day)
    }

    // если уже набрали минимум — можно остановиться
    if (availableDays.length >= minDays) break
  }

  return availableDays
}

// --- Получение свободных слотов на конкретный день с учетом часового пояса ---
async function getAvailableSlotsForDay(day: Date) {
  const slots: { start: Date; label: string }[] = []

  // --- Настройки рабочего дня и встреч ---
  const startHour = 11                 // рабочий день начинается в 11:00
  const endHour = 19                   // рабочий день заканчивается в 19:00
  const meetingDuration = 60           // длительность встречи (в минутах)
  const breakAfterMeeting = 30         // пауза после встречи (в минутах)
  const maxMeetingsPerDay = 5          // максимум встреч в день

  let meetingsCount = 0

  // Начинаем с 11:00 текущего дня
  let slotStart = new Date(day)
  slotStart.setHours(startHour, 0, 0, 0)

  // Цикл идёт по времени, пока:
  // 1) не вышли за пределы рабочего дня
  // 2) не превысили максимум встреч
  while (slotStart.getHours() < endHour && meetingsCount < maxMeetingsPerDay) {
    const slotEnd = new Date(slotStart.getTime() + meetingDuration * 60 * 1000)

    // Если встреча выходит за пределы рабочего времени — останавливаемся
    if (slotEnd.getHours() >= endHour && slotEnd.getMinutes() > 0) {
      break
    }

    // --- Проверяем Google Calendar ---
    const events = await calendar.events.list({
      calendarId: CALENDAR_ID!,
      timeMin: slotStart.toISOString(),
      timeMax: slotEnd.toISOString(),
      singleEvents: true,
    })

    // Если нет пересечений — добавляем слот
    if (!events.data.items || events.data.items.length === 0) {
      slots.push({
        start: new Date(slotStart),
        label: slotStart.toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      })

      meetingsCount++

      // Двигаем время вперёд: встреча + перерыв
      slotStart = new Date(slotEnd.getTime() + breakAfterMeeting * 60 * 1000)
    } else {
      // Если занято — двигаем время только на 30 минут
      slotStart = new Date(slotStart.getTime() + 30 * 60 * 1000)
    }
  }

  return slots
}

bot.start((ctx) => {
  ctx.reply("Привет! 👋 Напиши /book, чтобы забронировать встречу.")
})

bot.command("book", async (ctx) => {
  const days = await getAvailableDays(14)
  const buttons = days.map(d => [Markup.button.callback(
    d.toLocaleDateString("ru-RU"),
    `day_${d.toISOString()}`
  )])
  ctx.reply("Выберите день для встречи:", Markup.inlineKeyboard(buttons))
})

bot.action(/day_(.+)/, async (ctx) => {
  const day = new Date(ctx.match[1])
  const slots = await getAvailableSlotsForDay(day)
  if (slots.length === 0) return ctx.reply("Нет доступных слотов на этот день.")

  const buttons = slots.map(s => [Markup.button.callback(s.label, `slot_${s.start.getTime()}`)])
  ctx.reply("Выберите удобное время:", Markup.inlineKeyboard(buttons))
})

bot.action(/slot_(\d+)/, (ctx) => {
  const timestamp = parseInt(ctx.match[1])
  const startTime = new Date(timestamp)
  sessions.set(String(ctx.from!.id), { startTime })
  ctx.reply("Введите ваш email для подтверждения брони:")
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

  const start = DateTime.fromJSDate(session.startTime).setZone(TIMEZONE)
  const end = start.plus({ minutes: 60 })

  try {
    const event = {
      summary: "Консультация",
      description: `Забронировано через Telegram-бота.\nEmail клиента: ${email}`,
      start: {
        dateTime: start.toISO({ suppressMilliseconds: true }),
        timeZone: TIMEZONE, // 🔥 УКАЖИТЕ СВОЙ ЧАСОВОЙ ПОЯС!
      },
      end: {
        dateTime: end.toISO({ suppressMilliseconds: true }),
        timeZone: TIMEZONE,
      },
      // attendees: [ // only for business accounts in google
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