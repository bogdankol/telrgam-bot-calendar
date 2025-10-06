import { Telegraf, Markup } from 'telegraf'
import { google, calendar_v3 } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { DateTime } from 'luxon'
import { message } from 'telegraf/filters'
import { envCheck } from '@/utils/server-utils'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const bot = new Telegraf(BOT_TOKEN)

// --- Google Calendar настройка ---
const SCOPES = ['https://www.googleapis.com/auth/calendar']
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL!
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n')
const TIMEZONE = 'Europe/Kiev'

const auth = new google.auth.JWT({
	email: GOOGLE_CLIENT_EMAIL,
	key: GOOGLE_PRIVATE_KEY,
	scopes: SCOPES,
})

const calendar = google.calendar({ version: 'v3', auth })

// Простая "сессия" в памяти
const sessions = new Map<
	string,
	{
		startTime?: Date
		phone?: string
		name?: string
		email?: string
		waitingEmail?: boolean
	}
>()

// --- Получение доступных дней ---
async function getAvailableDays(daysAhead = 30, minDays = 10) {
	const now = DateTime.now().setZone(TIMEZONE)
	const availableDays: DateTime[] = []

	for (let i = 1; i <= daysAhead; i++) {
		const day = now.plus({ days: i })
		const weekday = day.weekday // 1 = Monday, 7 = Sunday
		if (weekday === 6 || weekday === 7) continue // пропускаем субботу и воскресенье

		const slots = await getAvailableSlotsForDay(day)

		if (slots.length > 0 || availableDays.length < minDays) {
			availableDays.push(day)
		}

		if (availableDays.length >= minDays) break
	}

	return availableDays
}

// --- Получение слотов ---
async function getAvailableSlotsForDay(day: DateTime) {
	const slots: { start: DateTime; label: string }[] = []
	const startHour = 11
	const endHour = 19
	const meetingDuration = 60 // мин
	const breakAfterMeeting = 30 // мин
	const maxMeetingsPerDay = 5

	let slotStart = day.set({
		hour: startHour,
		minute: 0,
		second: 0,
		millisecond: 0,
	})
	let slotCount = 0 // учитываем все слоты, чтобы не превысить лимит

	while (slotCount < maxMeetingsPerDay) {
		const slotEnd = slotStart.plus({ minutes: meetingDuration })

		const res = await calendar.events.list({
			// @ts-expect-error types error
			calendarId: CALENDAR_ID,
			timeMin: slotStart.toISO(),
			timeMax: slotEnd.toISO(),
			singleEvents: true,
		})

		// @ts-expect-error type error
		const events = res.data.items || []

		if (events.length === 0) {
			slots.push({
				start: slotStart,
				label: slotStart.toFormat('HH:mm'),
			})
		}

		slotCount++ // увеличиваем счетчик **всегда**, независимо от занятости слота
		slotStart = slotEnd.plus({ minutes: breakAfterMeeting })

		if (slotStart.hour >= endHour) break
	}

	return slots
}

// --- функция обработки контакта ---
function handlePhone(ctx: any) {
	const userId = String(ctx.from!.id)
	const session = sessions.get(userId)
	if (!session || !session.startTime) {
		return ctx.reply('Сначала выберите день и время встречи через /book.')
	}

	const contact = ctx.message.contact
	if (contact?.phone_number) {
		session.phone = contact.phone_number
		session.name =
			contact.first_name + (contact.last_name ? ' ' + contact.last_name : '')
		session.waitingEmail = true
		sessions.set(userId, session)
		ctx.reply('Спасибо! Теперь введите ваш email для подтверждения брони:')
	}
}

// tell phone number check
function isValidPhone(phone: string) {
  // убираем пробелы и дефисы для проверки
  const cleaned = phone.replace(/[\s-]/g, '');

  // проверяем на цифры и максимум один +
  if (/[^+\d]/.test(cleaned)) return false; // есть буквы или другие символы
  if ((cleaned.match(/\+/g) || []).length > 1) return false; // больше одного +
  if (!/^\+?\d{9,15}$/.test(cleaned)) return false; // длина номера
  return true;
}

// --- Команды бота ---
bot.start(async ctx => {
  const allEnvIsPresent = await envCheck()
  console.log({allEnvIsPresent})
  if(!allEnvIsPresent) {
    ctx.reply(`Доброго здоров'ячка! Наразі цей бот не працює, але не хвилюйтесь, через деякий час він обіцяє запрацювати.`)
  } else {
    ctx.reply(`Доброго здоров'ячка! 👋 Натисніть на /book, для того, щоб забронювати зустріч.`)
  }
})

bot.command('book', async ctx => {
	const days = await getAvailableDays(30)
	const buttons = days.map(d => [
		Markup.button.callback(d.toFormat('dd.MM.yyyy'), `day_${d.toISO()}`),
	])
	ctx.reply('Виберіть день для зустрічі:', Markup.inlineKeyboard(buttons))
})

// --- Выбор дня ---
bot.action(/day_(.+)/, async ctx => {
	const day = DateTime.fromISO(ctx.match[1]).setZone(TIMEZONE)
	const slots = await getAvailableSlotsForDay(day)

	if (slots.length === 0) return ctx.reply('Немає доступних часів на цей день.')

	const buttons = slots.map(s => [
		Markup.button.callback(s.label, `slot_${s.start.toMillis()}`),
	])

	ctx.reply('Виберіть зручний час:', Markup.inlineKeyboard(buttons))
})

// --- Выбор слота и запрос контакта ---
bot.action(/slot_(\d+)/, ctx => {
	const timestamp = parseInt(ctx.match[1])
	const startTime = DateTime.fromMillis(timestamp).toJSDate() // сохраняем JS Date
	sessions.set(String(ctx.from!.id), { startTime })

	ctx.reply(
		'Пожалуйста, поделитесь своим номером телефона для подтверждения брони:',
		Markup.keyboard([Markup.button.contactRequest('📱 Отправить контакт')])
			.oneTime()
			.resize(),
	)
})

// --- Получение контакта ---
bot.on('contact', handlePhone)

bot.on('text', async (ctx) => {
  const userId = String(ctx.from!.id);
  const session = sessions.get(userId);

  if (!session || !session.startTime) return;

  // если ждем телефон, а пользователь прислал текст
  if (!session.phone) {
    const phone = ctx.message.text.trim();
    if (!isValidPhone(phone)) {
      return ctx.reply(
        '❌ Невірний формат телефонного номеру.\n' +
        'Введіть номер телефону в одному із наступних форматів:\n' +
        '+0504122905, 0504122905, +050-412-29-05, 050-412-29-05'
      );
    }

    session.phone = phone;
    session.waitingEmail = true;
    sessions.set(userId, session);

    return ctx.reply('Дякую! Тепер введіть ваш email для підтвердження броні:');
  }

  // если уже есть телефон и ждём email
  if (session.waitingEmail) {
    const email = ctx.message.text.trim();
    if (!/^[\w.-]+@[\w.-]+\.\w+$/.test(email)) {
      return ctx.reply('❌ Невірний формат email. Спробуйте ще раз:');
    }

    session.email = email;
    delete session.waitingEmail;
    sessions.set(userId, session);

		// создаем событие в Google Calendar
		const start = DateTime.fromJSDate(session.startTime, { zone: TIMEZONE })
		const end = start.plus({ minutes: 60 })
    const event: calendar_v3.Schema$Event = {
      summary: 'Мітинг із психологом Ольгою Молодчинкою',
      description: `Заброньовано через телеграм-бота.\nДан клієнта: ${
        session.name || '—'
      }\nТелефон: ${session.phone}\nEmail: ${
        session.email
      }\n💰 Статус оплати консультації: не оплачено`,
      start: { dateTime: start.toISO(), timeZone: TIMEZONE },
      end: { dateTime: end.toISO(), timeZone: TIMEZONE },
      conferenceData: { createRequest: { requestId: `tg-${Date.now()}` } },
    }

    try {
      const res = await fetch(process.env.BASIC_URL + '/api/mono-form-link')
      console.log({res})
    } catch(err: unknown) {
      throw Error(`Invoice creation error:', ${err instanceof Error ? err.message : err}`)
    }

		try {
			const res = await calendar.events.insert({
				calendarId: CALENDAR_ID,
				requestBody: event,
				conferenceDataVersion: 1,
			})

			const paymentLink = 'https://send.monobank.ua/jar/XXXXXXXXX'
			const amount = 800

			await ctx.reply(
				`✅ Мітинг заброньовано!\n` +
					`📅 Дата та час: ${start.toFormat('dd.MM.yyyy HH:mm')}\n` +
					(res.data.hangoutLink
						? `🔗 Посилання на Google Meet: ${res.data.hangoutLink}\n`
						: `ℹ️ Запрошення буде вам надіслано трохи згодом на вказаний вами email.\n`) +
					`📞 Телефон: ${session.phone}\n` +
					`👤 Ім'я: ${session.name || '—'}\n` +
					`📧 Email: ${session.email}\n\n` +
					`💰 Статус оплати: ❌ не оплачено\n` +
					`Сума: ${amount} грн\n` +
					`👉 Для оплати перейдіть за посиланням(${paymentLink}). Дане посилання буде доступне на протязі 24 годин. Оплати, не то накреп нашлю!!!`,
				{ parse_mode: 'Markdown' },
			)

			sessions.delete(userId)
		} catch (err) {
			console.error('Помилка при створенні події:', err)
			await ctx.reply('⚠️ Не вдалось забронювати час та дату. Будь ласка, спробуйте пізніше.')
		}
	}
})

// --- Webhook handler ---
export async function POST(req: NextRequest) {
	try {
		const body = await req.json()
		await bot.handleUpdate(body)
		return NextResponse.json({ ok: true })
	} catch (err) {
		console.error('Telegram webhook error:', err)
		return NextResponse.json({ error: 'failed' }, { status: 500 })
	}
}

export async function GET() {
  return NextResponse.json({ message: 'bot works' })
}