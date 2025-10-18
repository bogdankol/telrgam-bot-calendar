import { Telegraf, Markup } from 'telegraf'
import { google, calendar_v3 } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { DateTime } from 'luxon'
import {
	checkNotificationBotAvailability,
	envCheck,
} from '@/utils/server-utils'
// import { createNewInvoiceLink } from '@/actions/server-actions'
import { TIMEZONE, SCOPES, OFFLINE_MEETING_MESSAGE, ONLINE_MEETING_MESSAGE } from '@/lib/vars'
import {
	getAvailableDays,
	getAvailableSlotsForDay,
	handlePhone,
} from '@/lib/helpers'
import { v4 as uuidv4 } from 'uuid'
import { getUpcomingMeetings } from '@/actions/server-actions'

// --- Google Calendar настройка ---
const GOOGLE_CALENDAR_MY_ID = process.env.GOOGLE_CALENDAR_MY_ID!
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL!
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n')

const TELEGRAM_EVENTS_BOT_TOKEN = process.env.TELEGRAM_EVENTS_BOT_TOKEN!
const TELEGRAM_NOTIFICATION_BOT_TOKEN =
	process.env.TELEGRAM_NOTIFICATION_BOT_TOKEN!
const ADMIN_ID = process.env.BOT_ADMIN_ID!
const bot_events = new Telegraf(TELEGRAM_EVENTS_BOT_TOKEN)
const bot_notification = new Telegraf(TELEGRAM_NOTIFICATION_BOT_TOKEN)

const auth = new google.auth.JWT({
	email: GOOGLE_CLIENT_EMAIL,
	key: GOOGLE_PRIVATE_KEY,
	scopes: SCOPES,
})

export const myCalendar = google.calendar({ version: 'v3', auth })

// Простая "сессия" в памяти
export const sessions = new Map<
	string,
	{
		sessionId: string
		startTime?: Date
		name?: string
		phone?: string
		email?: string
		reason?: string
		waitingName?: boolean
		meetingType?: string
    meetingMessage?: string
		waitingForReasonOfMeeting?: boolean
		waitingForMeetingType?: boolean
		waitingPhone?: boolean
		waitingEmail?: boolean
		completed?: boolean
	}
>()

// --- Команды бота ---
bot_events.start(async ctx => {
	const userId = String(ctx.from!.id)
	sessions.delete(userId)

	const allEnvIsPresent = await envCheck()
	if (!allEnvIsPresent) {
		await ctx.reply(
			`Доброго здоров'ячка! Наразі цей бот не працює, але не хвилюйтесь, через деякий час він обіцяє запрацювати.`,
      { parse_mode: 'HTML' },
		)
	}

	await ctx.reply(
		`Доброго здоров'ячка! 👋 Натисніть на /book, для того, щоб забронювати зустріч. Або натисніть на /get_meetings для отримання інформації про поточні мітинги на наступні два тижні.`,
    Markup.keyboard([['Отримати інформацію про майбутні мітинги']])
      .resize()
      .persistent()
	)
})

bot_events.command('book', async ctx => {
	const notificationBotWorks = await checkNotificationBotAvailability()
	if (!notificationBotWorks) {
		await ctx.reply(
			'Вибачте, але сталася помилка. Ми вже працюємо над цим. Будь ласка, повторіть спробу пізніше.',
      { parse_mode: 'HTML' },
		)
		return
	}

	const userId = String(ctx.from.id)
	sessions.delete(userId)

	await ctx.reply('🔄 Будь ласка зачекайте, йде завантаження доступних днів...', { parse_mode: 'HTML' },)

	try {
		const days = await getAvailableDays(30)
		const sessionId = uuidv4().split('-').join('').substring(0, 30)
		sessions.set(userId, { sessionId })

		const buttons = days.map(d => [
			Markup.button.callback(
				d.toFormat('dd.MM.yyyy'),
				`day_${sessionId}_${d.toISO()}`,
			),
		])

		await ctx.reply(
			'📅 Виберіть день для зустрічі:',
			Markup.inlineKeyboard(buttons),
		)
	} catch (err) {
		console.error('Error during days obtaining:', { err })
		await ctx.reply(
			'⚠️ Не вдалося завантажити доступні дні. Будь ласка, спробуйте пізніше.',
      { parse_mode: 'HTML' },
		)
	}
})

// --- Выбор дня ---
bot_events.action(/day_(.+?)_(.+)/, async ctx => {
	const userId = String(ctx.from!.id)
	const session = sessions.get(userId)
	const [clickedSessionId, dayISO] = [ctx.match[1], ctx.match[2]]

	if (!session || session.sessionId !== clickedSessionId || session.completed) {
		return await ctx.reply(
			'🤖 Поточне бронювання вже завершено або застаріло. Натисніть /book, щоб почати заново.  Або натисніть на /get_meetings для отримання інформації про поточні мітинги на наступні два тижні.',
      { parse_mode: 'HTML' },
		)
	}

	const day = DateTime.fromISO(dayISO).setZone(TIMEZONE)
	const slots = await getAvailableSlotsForDay(day)

	if (slots.length === 0) return await ctx.reply('Немає доступних часів на цей день.', { parse_mode: 'HTML' },)

	const buttons = slots.map(s => {
		// Формируем текст кнопки с временем и датой
		const label = `${s.start.toFormat('dd.MM.yyyy')} — ${s.start.toFormat(
			'HH:mm',
		)}`
		return [
			Markup.button.callback(
				label,
				`slot_${clickedSessionId}_${s.start.toMillis()}`,
			),
		]
	})

	ctx.reply('Виберіть зручний час:', Markup.inlineKeyboard(buttons))
})

// --- Выбор слота и запрос имени ---
bot_events.action(/slot_(.+?)_(\d+)/, async ctx => {
	const userId = String(ctx.from!.id)
	const session = sessions.get(userId)
	const [clickedSessionId, timestampStr] = [ctx.match[1], ctx.match[2]]

	if (!session || session.sessionId !== clickedSessionId || session.completed) {
		return await ctx.reply(
			'🤖 Поточне бронювання вже завершено або застаріло. Натисніть /book, щоб почати заново. Або натисніть на /get_meetings для отримання інформації про поточні мітинги на наступні два тижні.',
      { parse_mode: 'HTML' },
		)
	}

	const timestamp = parseInt(timestampStr)
	const startTime = DateTime.fromMillis(timestamp).setZone(TIMEZONE)

	const day = startTime.startOf('day')
	const slots = await getAvailableSlotsForDay(day)
	const slotTaken = !slots.some(s => s.start.toMillis() === timestamp)
	if (slotTaken) {
		return await ctx.reply(
			'❌ На жаль, вибраний час вже зайнятий. Будь ласка, оберіть інший час.',
      { parse_mode: 'HTML' },
		)
	}

	// обновляем сессию с выбранным временем и ждем имя
	session.startTime = startTime.toJSDate()
	session.waitingName = true
	sessions.set(userId, session)

	await ctx.reply("Будь ласка, введіть ваше ім'я для бронювання:", { parse_mode: 'HTML' })
})

// --- Выбор формата встречи ---
bot_events.action(/meeting_(offline|online)/, async ctx => {
	const userId = String(ctx.from!.id)
	const session = sessions.get(userId)

	if (!session || session.completed) {
		return await ctx.reply(
			'🤖 Поточне бронювання вже завершено. Натисніть /book, щоб почати заново. Або натисніть на /get_meetings для отримання інформації про поточні мітинги на наступні два тижні.',
      { parse_mode: 'HTML' }
		)
	}

	const type = ctx.match[1]

	if (!type) {
		await ctx.reply('Необхідно обрати один з двох запропонованих варіантів', { parse_mode: 'HTML' },)
	}
	// if (type === 'offline') {
	// 	session.meetingType = OFFLINE_MEETING_MESSAGE
	// } else {
		session.meetingType = type
	// }

	session.waitingPhone = true
	sessions.set(userId, session)

	await ctx.reply(
		'Будь ласка, поділіться своїм номером телефону (у одному з наступних форматів:\n +0504122905\n, +050-412-29-05\n, +38-050-412-29-05\n, +380504122905)\n\n або надішліть свій контакт для підтвердження броні:',
		Markup.keyboard([Markup.button.contactRequest('📱 Надіслати контакт')])
			.oneTime()
			.resize(),
	)
})

bot_events.command('get_meetings', async ctx => {
	const userId = String(ctx.from.id)
	await ctx.reply('Збираю інформацію про ваші мітинги...', { parse_mode: 'HTML' })

	await getUpcomingMeetings(
    userId, TIMEZONE, myCalendar, GOOGLE_CALENDAR_MY_ID, ctx
  )
})

bot_events.hears('Отримати інформацію про майбутні мітинги', async ctx => {
  // Просто перенаправляем в action, который уже всё делает
 await bot_events.handleUpdate({
		update_id: Date.now(),
		message: {
			message_id: Date.now(),
			date: Math.floor(Date.now() / 1000),
			chat: { id: ctx.chat.id, type: ctx.chat.type },
			from: ctx.from,
			text: '/get_meetings',
			entities: [{ offset: 0, length: 13, type: 'bot_command' }],
		},
	} as any)
})

// --- Получение контакта ---
bot_events.on('contact', ctx => handlePhone(ctx, sessions))

// --- Обработка текстовых сообщений ---
bot_events.on('text', async ctx => {
	const userId = String(ctx.from!.id)
	const session = sessions.get(userId)

	if (!session) {
		return await ctx.reply(
			'🤖 Для початку натисніть /book, щоб розпочати бронювання зустрічі. Або натисніть на /get_meetings для отримання інформації про поточні мітинги на наступні два тижні.',
      { parse_mode: 'HTML' }
		)
	}

	if (session.completed) {
		return await ctx.reply(
			'🤖 Поточне бронювання вже завершено. Натисніть /book, щоб почати заново. Або натисніть на /get_meetings для отримання інформації про поточні мітинги на наступні два тижні.',
      { parse_mode: 'HTML' }
		)
	}

	// ждем имя
	if (session.waitingName) {
		const name = ctx.message.text.trim()
		if (name.length < 2) {
			return await ctx.reply("❌ Ім'я занадто коротке. Введіть своє ім'я ще раз:")
		}
		session.name = name
		session.waitingName = false
		session.waitingForReasonOfMeeting = true
		sessions.set(userId, session)

		await ctx.reply(
			'Будь ласка, поділіться тим що вас турбує, із чим ви хочете впоратись за допомогою моєї допомоги:',
      { parse_mode: 'HTML' }
		)
		return
	}

	// тут мы ждем причину для обращения к Оле
	if (session.waitingForReasonOfMeeting) {
		const reason = ctx.message.text.trim()
		if (reason.length < 10) {
			return await ctx.reply(
				'❌ Опис проблеми занадто короткий, опишіть більш детально.',
        { parse_mode: 'HTML' }
			)
		}
		if (reason.length > 500) {
			return await ctx.reply(
				'❌ Опис проблеми занадто довгий, спробуйте описати менш детально.',
        { parse_mode: 'HTML' }
			)
		}
		session.reason = reason
		session.waitingForReasonOfMeeting = false
		sessions.set(userId, session)

		await ctx.reply(
			'Будь ласка, оберіть формат зустрічі:',
			Markup.inlineKeyboard([
				[
					Markup.button.callback(
						'🏢 В офісі (адреса 1 буд 11 офіс 111 поверх 1111)',
						`meeting_offline`,
					),
				],
				[Markup.button.callback('💻 Онлайн (Google Meet)', `meeting_online`)],
			]),
		)
		return
	}

	// ждем телефон
	if (session.waitingPhone) {
		const phone = ctx.message.text.trim()
		const validPhonePattern =
			/^\+?(38)?[-\s()]?0\d{2}[-\s()]?\d{3}[-\s()]?\d{2}[-\s()]?\d{2}$/

		if (!validPhonePattern.test(phone)) {
			return await ctx.reply(
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
		session.waitingPhone = false
		session.waitingEmail = true
		sessions.set(userId, session)
		return await ctx.reply('Дякую! Тепер введіть ваш email для підтвердження броні:', { parse_mode: 'HTML' })
	}

	// ждем email
	if (session.waitingEmail) {
		const email = ctx.message.text.trim()
		const validEmailPattern = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/

		if (!validEmailPattern.test(email)) {
			return await ctx.reply('❌ Невірний формат email. Спробуйте ще раз:', { parse_mode: 'HTML' })
		}

		session.email = email
		delete session.waitingEmail
		sessions.set(userId, session)

		const start = session.startTime
			? DateTime.fromJSDate(session.startTime, { zone: TIMEZONE })
			: DateTime.local().setZone(TIMEZONE)
		const end = start.plus({ minutes: 60 })

		const event: calendar_v3.Schema$Event = {
			summary: 'Мітинг із психологом Ольгою Енгельс',
			description: `Заброньовано через телеграм-бота.\n Дані клієнта: ${session.name}\nТелефон: ${session.phone}\n Email: ${session.email}\n Фoрмат зустрічі: ${session.meetingType === 'offline' ? OFFLINE_MEETING_MESSAGE : ONLINE_MEETING_MESSAGE.split('.')[0]}\n Опис підстави для звернення: ${session.reason}\n\n\n clientId: ${userId} `,
			start: { dateTime: start.toISO(), timeZone: TIMEZONE },
			end: { dateTime: end.toISO(), timeZone: TIMEZONE },
			conferenceData: { createRequest: { requestId: `tg-${Date.now()}` } },
		}

		try {
			const res = await myCalendar.events.insert({
				calendarId: GOOGLE_CALENDAR_MY_ID,
				requestBody: event,
				conferenceDataVersion: 1,
			})

			await ctx.reply(
				`✅ Мітинг заброньовано!\n` +
					`📅 Дата та час: ${start.toFormat('dd.MM.yyyy HH:mm')}\n` +
					(res.data.hangoutLink
						? `🔗 Посилання на Google Meet: ${res.data.hangoutLink}\n`
						: `ℹ️ Запрошення буде надіслано на ваш email.\n`) +
					`📞 Телефон: ${session.phone}\n` +
					`Формат зустрічі: ${session.meetingType === 'offline' ? OFFLINE_MEETING_MESSAGE : ONLINE_MEETING_MESSAGE}\n` +
					`👤 Ім'я: ${session.name}\n` +
					`📧 Email: ${session.email}\n\n` +
					` Опис підстави для звернення: ${session.reason}\n`,
				{ parse_mode: 'HTML' },
			)

			session.completed = true
			sessions.set(userId, session)

			await bot_notification.telegram.sendMessage(
				ADMIN_ID,
				`📢 НОВЕ БРОНЮВАННЯ\n\n` +
					`📅 Дата та час: ${start.toFormat('dd.MM.yyyy HH:mm')}\n` +
					`📞 Телефон: ${session.phone}\n` +
					`Формат зустрічі: ${session.meetingType === 'offline' ? OFFLINE_MEETING_MESSAGE : ONLINE_MEETING_MESSAGE.split('.')[0]}\n` +
					`👤 Ім'я: ${session.name}\n` +
					`📧 Email: ${session.email}\n\n` +
					` Опис підстави для звернення: ${session.reason}\n`,
				{ parse_mode: 'HTML' },
			)

			await ctx.reply(
				'Для того, щоб забронювати ще одну зустріч, натисніть /start. Для того, щоб отримати інформацію про всі наші зустрічі на найближчі два тижні, натисніть /get_meetings',
        { parse_mode: 'HTML' },
			)
		} catch (err) {
			console.error('Помилка при створенні події на фінальному етапі:', err)
			await ctx.reply(
				'⚠️ Не вдалось забронювати час та дату. Будь ласка, спробуйте пізніше.',
        { parse_mode: 'HTML' },
			)
		}
		return
	}

	return await ctx.reply(
		'🤖 Вибачте, введений вами текст мені не зрозумілий.\n\n' +
			'Для початку роботи натисніть на /book',
      { parse_mode: 'HTML' },
	)
})

// --- Webhook handler ---
export async function POST(req: NextRequest) {
	try {
		const body = await req.json()
		await bot_events.handleUpdate(body)
		return NextResponse.json({ ok: true })
	} catch (err) {
		console.error('Telegram webhook error:', err)
		return NextResponse.json({ error: 'failed' }, { status: 500 })
	}
}

export async function GET() {
	return NextResponse.json({ message: 'bot works' })
}
