import { Telegraf, Markup } from 'telegraf'
import { google, calendar_v3 } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { DateTime } from 'luxon'
import { envCheck } from '@/utils/server-utils'
import { createNewInvoiceLink } from '@/actions/server-actions'
import { TIMEZONE, SCOPES, invoiceCheckUrl } from '@/lib/vars'
import {
	getAvailableDays,
	getAvailableSlotsForDay,
	handlePhone,
	isValidPhone,
} from '@/lib/helpers'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const bot = new Telegraf(BOT_TOKEN)

// --- Google Calendar настройка ---
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL!
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n')

const auth = new google.auth.JWT({
	email: GOOGLE_CLIENT_EMAIL,
	key: GOOGLE_PRIVATE_KEY,
	scopes: SCOPES,
})

export const calendar = google.calendar({ version: 'v3', auth })

// Простая "сессия" в памяти
export const sessions = new Map<
	string,
	{
		startTime?: Date
		phone?: string
		name?: string
		email?: string
		waitingEmail?: boolean
		completed?: boolean
	}
>()

// --- Команды бота ---
bot.start(async ctx => {
  const userId = String(ctx.from!.id)
	sessions.delete(userId)

	const allEnvIsPresent = await envCheck()
	if (!allEnvIsPresent) {
		ctx.reply(
			`Доброго здоров'ячка! Наразі цей бот не працює, але не хвилюйтесь, через деякий час він обіцяє запрацювати.`,
		)
	} else {
		ctx.reply(
			`Доброго здоров'ячка! 👋 Натисніть на /book, для того, щоб забронювати зустріч.`,
		)
	}
})

bot.command('book', async ctx => {
  const userId = String(ctx.from!.id)
	sessions.delete(userId)

	await ctx.reply('🔄 Будь ласка зачекайте, йде завантаження доступних днів...')

	try {
		const days = await getAvailableDays(30)
		const buttons = days.map(d => [
			Markup.button.callback(d.toFormat('dd.MM.yyyy'), `day_${d.toISO()}`),
		])

		await ctx.reply(
			'📅 Виберіть день для зустрічі:',
			Markup.inlineKeyboard(buttons),
		)
	} catch (err) {
		console.error('Error during days obtaining:', { err })
		await ctx.reply(
			'⚠️ Не вдалося завантажити доступні дні. Будь ласка, спробуйте пізніше.',
		)
	}
})

// --- Выбор дня ---
bot.action(/day_(.+)/, async ctx => {
  const userId = String(ctx.from!.id)
	const session = sessions.get(userId)

	// если сессия завершена или уже была — не разрешаем нажимать старые кнопки
	if (session && session.completed) {
		return ctx.reply(
			'🤖 Поточне бронювання вже завершено. Натисніть /book, щоб почати заново.',
		)
	}

	const day = DateTime.fromISO(ctx.match[1]).setZone(TIMEZONE)
	const slots = await getAvailableSlotsForDay(day)

	if (slots.length === 0) return ctx.reply('Немає доступних часів на цей день.')

	const buttons = slots.map(s => [
		Markup.button.callback(s.label, `slot_${s.start.toMillis()}`),
	])

	ctx.reply('Виберіть зручний час:', Markup.inlineKeyboard(buttons))
})

// --- Выбор слота и запрос контакта ---
bot.action(/slot_(\d+)/, async ctx => {
	const userId = String(ctx.from!.id)
	const session = sessions.get(userId)

	// если сессия завершена или уже была — не разрешаем нажимать старые кнопки
	if (session && session.completed) {
		return ctx.reply(
			'🤖 Поточне бронювання вже завершено. Натисніть /book, щоб почати заново.',
		)
	}

	const timestamp = parseInt(ctx.match[1])
	const startTime = DateTime.fromMillis(timestamp).setZone(TIMEZONE)

	// Проверяем, свободен ли слот
	const day = startTime.startOf('day')
	const slots = await getAvailableSlotsForDay(day)
	const slotTaken = !slots.some(s => s.start.toMillis() === timestamp)
	if (slotTaken) {
		return ctx.reply(
			'❌ На жаль, вибраний час вже зайнятий. Будь ласка, оберіть інший час.',
		)
	}

	// создаем новую сессию (перезаписываем старую)
	sessions.set(userId, { startTime: startTime.toJSDate() })

	await ctx.reply(
		'Будь ласка, поділіться своїм номером телефону (у одному з наступних форматів:\n +0504122905, +050-412-29-05, +38-050-412-29-05, +380504122905)\n або контактом для підтвердження броні:',
		Markup.keyboard([Markup.button.contactRequest('📱 Отправить контакт')])
			.oneTime()
			.resize(),
	)
})

// --- Получение контакта ---
bot.on('contact', handlePhone)

// --- Обработка текстовых сообщений ---
bot.on('text', async ctx => {
	const userId = String(ctx.from!.id)
	const session = sessions.get(userId)

	if (!session) {
		return ctx.reply(
			'🤖 Для початку натисніть /book, щоб розпочати бронювання зустрічі.',
		)
	}

	// если бронирование уже завершено
	if (session.completed) {
		return ctx.reply('🤖 Поточне бронювання вже завершено. Натисніть /book, щоб почати заново.')
	}

	// если ждем телефон
	if (!session.phone && !session.waitingEmail) {
		const phone = ctx.message.text.trim()
		const validPhonePattern =
			/^\+?(38)?[-\s()]?0\d{2}[-\s()]?\d{3}[-\s()]?\d{2}[-\s()]?\d{2}$/

		if (!validPhonePattern.test(phone)) {
			return ctx.reply(
				'❌ Невірний формат телефонного номеру.\n\n' +
					'Дозволені формати:\n' +
					'• +0504122905\n' +
					'• +050-412-29-05\n' +
					'• +38-050-412-29-05\n' +
					'• +380504122905\n' +
					'• +38 050 412 29 05\n\n' +
					'Будь ласка, введіть номер у правильному форматі або надішліть свій контакт:',
				Markup.keyboard([Markup.button.contactRequest('📱 Надіслати контакт')])
					.oneTime()
					.resize(),
			)
		}

		session.phone = phone
		session.waitingEmail = true
		sessions.set(userId, session)
		return ctx.reply('Дякую! Тепер введіть ваш email для підтвердження броні:')
	}

	// если ждем email
	if (session.waitingEmail) {
		const email = ctx.message.text.trim()
		const validEmailPattern = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/

		if (!validEmailPattern.test(email)) {
			return ctx.reply('❌ Невірний формат email. Спробуйте ще раз:')
		}

		session.email = email
		delete session.waitingEmail
		sessions.set(userId, session)

		const invoiceData = await createNewInvoiceLink()
		if (!invoiceData) {
			return ctx.reply(
				'Помилка при створенні зустрічі. Будь ласка, спробуйте пізніше',
			)
		}

		const start = session.startTime
			? DateTime.fromJSDate(session.startTime, { zone: TIMEZONE })
			: DateTime.local().setZone(TIMEZONE)
		const end = start.plus({ minutes: 60 })

		const event: calendar_v3.Schema$Event = {
			summary: 'Мітинг із психологом Ольгою Енгельс',
			description: `Заброньовано через телеграм-бота.\nДані клієнта: ${
				session.name || '—'
			}\nТелефон: ${session.phone}\nEmail: ${
				session.email
			}\n💰 Статус оплати консультації: не оплачено\n
        посилання на інвойс: ${invoiceData?.pageUrl}\n
        айдішник інвойсу: ${invoiceData?.invoiceId}\n
        перевірити оплату: ${
					process.env.BASIC_URL + invoiceCheckUrl
				}?invoiceId=${invoiceData?.invoiceId}`,
			start: { dateTime: start.toISO(), timeZone: TIMEZONE },
			end: { dateTime: end.toISO(), timeZone: TIMEZONE },
			conferenceData: { createRequest: { requestId: `tg-${Date.now()}` } },
		}

		try {
			const res = await calendar.events.insert({
				calendarId: CALENDAR_ID,
				requestBody: event,
				conferenceDataVersion: 1,
			})

			const paymentLink = invoiceData?.pageUrl
			const amount = 800

			await ctx.reply(
				`✅ Мітинг заброньовано!\n` +
					`📅 Дата та час: ${start.toFormat('dd.MM.yyyy HH:mm')}\n` +
					(res.data.hangoutLink
						? `🔗 Посилання на Google Meet: ${res.data.hangoutLink}\n`
						: `ℹ️ Запрошення буде надіслано на ваш email.\n`) +
					`📞 Телефон: ${session.phone}\n` +
					`👤 Ім'я: ${session.name || '—'}\n` +
					`📧 Email: ${session.email}\n\n` +
					`💰 Статус оплати: ❌ не оплачено\n` +
					`Сума: ${amount} грн\n` +
					`👉 Для оплати перейдіть за посиланням (${paymentLink}). Посилання дійсне 24 години.`,
				{ parse_mode: 'Markdown' },
			)

			// Помечаем сессию завершённой — старые кнопки больше не активны
			session.completed = true
			sessions.set(userId, session)

			await ctx.reply('Для продовження роботи натисніть /book або /start')
		} catch (err) {
			console.error('Помилка при створенні події:', err)
			await ctx.reply(
				'⚠️ Не вдалось забронювати час та дату. Будь ласка, спробуйте пізніше.',
			)
		}
		return
	}

	return ctx.reply(
		'🤖 Вибачте, введений вами текст мені не зрозумілий.\n\n' +
			'Для початку натисніть на /book',
	)
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
