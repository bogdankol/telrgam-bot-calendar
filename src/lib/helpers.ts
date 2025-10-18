import { DateTime } from 'luxon'
import { TIMEZONE } from './vars'
import { calendar_v3 } from 'googleapis'

// --- Получение доступных дней ---
export async function getAvailableDays(
	daysAhead = 30,
	minDays = 10,
	myCalendar: calendar_v3.Calendar,
	myCalendarId: string,
	workCalendarId: string,
) {
	const now = DateTime.now().setZone(TIMEZONE)
	const candidateDays: DateTime[] = []

	for (let i = 1; i <= daysAhead; i++) {
		const day = now.plus({ days: i })
		const weekday = day.weekday // 1 = Monday, 7 = Sunday
		if (weekday === 6 || weekday === 7) continue // пропускаем выходные
		candidateDays.push(day)
	}

	// Получаем все дни параллельно
	const results = await Promise.all(
		candidateDays.map(async day => {
			const slots = await getAvailableSlotsForDay(
				day,
				myCalendar,
				myCalendarId,
				workCalendarId,
			)
			return { day, hasSlots: slots.length > 0 }
		}),
	)

	// Отбираем дни с доступными слотами
	const availableDays = results
		.filter(r => r.hasSlots)
		.map(r => r.day)
		.slice(0, minDays)

	// Если доступных меньше, добавляем первые из списка (для minDays)
	while (
		availableDays.length < minDays &&
		availableDays.length < results.length
	) {
		const next = results[availableDays.length]
		if (next) availableDays.push(next.day)
		else break
	}

	return availableDays
}

// --- Получение слотов ---
export async function getAvailableSlotsForDay(
	day: DateTime,
	myCalendar: calendar_v3.Calendar,
	myCalendarId: string,
	workCalendarId: string,
) {
	const startHour = 11
	const endHour = 19
	const meetingDuration = 60 // мин
	const breakAfterMeeting = 0 // мин
	const maxMeetingsPerDay = 8

	// ✅ Убедимся, что day имеет нужную зону
	let slotStart = day.setZone(TIMEZONE).set({
		hour: startHour,
		minute: 0,
		second: 0,
		millisecond: 0,
	})

	const timeRanges: { start: string; end: string }[] = []

	for (let i = 0; i < maxMeetingsPerDay; i++) {
		const slotEnd = slotStart.plus({ minutes: meetingDuration })
		if (slotEnd.hour > endHour) break

		// ✅ Принудительно сохраняем локальное время
		timeRanges.push({
			start: slotStart.toISO({ suppressMilliseconds: true })!,
			end: slotEnd.toISO({ suppressMilliseconds: true })!,
		})

		slotStart = slotEnd.plus({ minutes: breakAfterMeeting })
	}

	// 📡 Один общий запрос к FreeBusy API для ОБОИХ календарей
	const res = await myCalendar.freebusy.query({
		requestBody: {
			timeMin: timeRanges[0].start,
			timeMax: timeRanges[timeRanges.length - 1].end,
			timeZone: TIMEZONE, // ✅ указываем зону явно
			items: [{ id: myCalendarId }, { id: workCalendarId }],
		},
	})

	// 🧩 Объединяем занятые интервалы
	const busyPrimary = res.data.calendars?.[myCalendarId]?.busy || []
	const busySecondary = res.data.calendars?.[workCalendarId]?.busy || []
	const allBusy = [...busyPrimary, ...busySecondary]

	// 📆 Фильтруем только свободные интервалы
	const availableSlots = timeRanges
		.map(range => {
			const start = DateTime.fromISO(range.start, { zone: TIMEZONE })
			const end = DateTime.fromISO(range.end, { zone: TIMEZONE })

			const overlaps = allBusy.some(
				busy =>
					DateTime.fromISO(busy.start!, { zone: TIMEZONE }) < end &&
					DateTime.fromISO(busy.end!, { zone: TIMEZONE }) > start,
			)

			return !overlaps ? { start, label: start.toFormat('HH:mm') } : null
		})
		.filter(Boolean)

	return availableSlots as { start: DateTime; label: string }[]
}

// --- функция обработки контакта ---
export function handlePhone(ctx: any, sessions: any) {
	const userId = String(ctx.from!.id)
	// console.log({ctx, userId, from: ctx?.from, ctxString: JSON.parse(JSON.stringify(ctx)).update.message})
	const session = sessions.get(userId)
	if (!session || !session.startTime) {
		return ctx.reply('Для початку виберіть день та час зустрічі через /book.')
	}

	const contact = ctx.message.contact

	if (!contact) {
		return ctx.reply(
			'⚠️ Ви не поділилися контактом. Будь ласка, натисніть кнопку або введіть номер вручну.',
		)
	}

	if (!contact.phone_number) {
		session.waitingPhone = true
		sessions.set(userId, session)
		return ctx.reply(
			'⚠️ У вашому Telegram-контакті відсутній номер телефону.\n\n' +
				'Будь ласка, введіть його вручну в одному з форматів:\n' +
				'• +0504122905\n' +
				'• +050-412-29-05\n' +
				'• +38-050-412-29-05\n' +
				'• +380504122905\n' +
				'• +38 050 412 29 05',
		)
	}

	session.phone = contact.phone_number
	session.waitingPhone = false
	session.waitingEmail = true
	sessions.set(userId, session)
	ctx.reply('Дякую! тепер введіть email на який буде надіслано запрошення:')
}

// tell phone number check
export function isValidPhone(phone: string) {
	// убираем пробелы и дефисы для проверки
	const cleaned = phone.replace(/[\s-]/g, '')

	// проверяем на цифры и максимум один +
	if (/[^+\d]/.test(cleaned)) return false // есть буквы или другие символы
	if ((cleaned.match(/\+/g) || []).length > 1) return false // больше одного +
	if (!/^\+?\d{9,15}$/.test(cleaned)) return false // длина номера
	return true
}
