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
	}
>()

// --- Команды бота ---
bot.start(async ctx => {
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
		'Будь ласка, поділіться своїм номером телефону (у одному з наступних форматів:\n +0504122905, +050-412-29-05, +38-050-412-29-05, +380504122905\n ) або контактом для підтвердження броні:',
		Markup.keyboard([Markup.button.contactRequest('📱 Отправить контакт')])
			.oneTime()
			.resize(),
	)
})

// --- Получение контакта ---
bot.on('contact', handlePhone)

bot.on('text', async ctx => {
	const userId = String(ctx.from!.id)
	const session = sessions.get(userId)

	if (!session || !session.startTime)
		return ctx.reply(
			'🤖 Вибачте, введений вами текст мені не зрозумілий.\n\n' +
				'Будь ласка, натисніть на /book або введіть команду /book вручну, щоб розпочати бронювання зустрічі.',
		)

	if (!session.startTime) return

	// если ждем телефон, а пользователь прислал текст
	if (!session.phone) {
		const phone = ctx.message.text.trim()

		// Разрешаем только форматы:
		// +0504122905
		// +050-412-29-05
		// +38-050-412-29-05
		// +380504122905
		const validPhonePattern =
			/^(\+050\d{7,8}|\+050-\d{3}-\d{2}-\d{2}|\+38-050-\d{3}-\d{2}-\d{2}|\+38050\d{7,8})$/

		if (!validPhonePattern.test(phone)) {
			return ctx.reply(
				'❌ Невірний формат телефонного номеру.\n\n' +
					'Дозволені формати:\n' +
					'• +0504122905\n' +
					'• +050-412-29-05\n' +
					'• +38-050-412-29-05\n' +
					'• +380504122905\n' +
          '• 38 050 412 29 05\n' +
          '• +38 050 412 29 05\n\n' +
					'Будь ласка, введіть номер у правильному форматі.',
			)
		}

		session.phone = phone
		session.waitingEmail = true
		sessions.set(userId, session)

		return ctx.reply('Дякую! Тепер введіть ваш email для підтвердження броні:')
	}

	// если уже есть телефон и ждём email
	if (session.waitingEmail) {
		const email = ctx.message.text.trim()
		if (!/^[\w.-]+@[\w.-]+\.\w+$/.test(email)) {
			return ctx.reply('❌ Невірний формат email. Спробуйте ще раз:')
		}

		session.email = email
		delete session.waitingEmail
		sessions.set(userId, session)

		const invoiceData = await createNewInvoiceLink()

		if (!invoiceData) {
			await ctx.reply(
				'Помилка при створенні зустрічі. Будь ласка, спробуйте пізніше',
			)
		}

		// создаем событие в Google Calendar
		const start = DateTime.fromJSDate(session.startTime, { zone: TIMEZONE })
		const end = start.plus({ minutes: 60 })
		const event: calendar_v3.Schema$Event = {
			summary: 'Мітинг із психологом Ольгою Енгельс',
			description: `Заброньовано через телеграм-бота.\nДані клієнта: ${
				session.name || '—'
			}\nТелефон: ${session.phone}\nEmail: ${
				session.email
			}\n💰 Статус оплати консультації: не оплачено\n
        посилання на інвойс: ${invoiceData?.pageUrl}, \n
        айдішник інвойсу: ${invoiceData?.invoiceId},
        посилання, де можна перевірити чи оплачений інвойс: ${
					process.env.BASIC_URL +
					invoiceCheckUrl +
					`?invoiceId=${invoiceData?.invoiceId}`
				}
      `,
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
						: `ℹ️ Запрошення буде вам надіслано трохи згодом на вказаний вами email.\n`) +
					`📞 Телефон: ${session.phone}\n` +
					`👤 Ім'я: ${session.name || '—'}\n` +
					`📧 Email: ${session.email}\n\n` +
					`💰 Статус оплати: ❌ не оплачено\n` +
					`Сума: ${amount} грн\n` +
					`👉 Для оплати перейдіть за посиланням(${paymentLink}). Дане посилання буде доступне на протязі 24 годин. Оплати, не то понос нашлю!!!`,
				{ parse_mode: 'Markdown' },
			)

			sessions.delete(userId)
		} catch (err) {
			console.error('Помилка при створенні події:', err)
			await ctx.reply(
				'⚠️ Не вдалось забронювати час та дату. Будь ласка, спробуйте пізніше.',
			)
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
