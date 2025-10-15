import { calendar } from '@/app/api/telegram-bot/route'
import { DateTime } from 'luxon'
import { TIMEZONE } from './vars'

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!

// --- Получение доступных дней ---
export async function getAvailableDays(daysAhead = 30, minDays = 10) {
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
		candidateDays.map(async (day) => {
			const slots = await getAvailableSlotsForDay(day)
			return { day, hasSlots: slots.length > 0 }
		})
	)

	// Отбираем дни с доступными слотами
	const availableDays = results
		.filter((r) => r.hasSlots)
		.map((r) => r.day)
		.slice(0, minDays)

	// Если доступных меньше, добавляем первые из списка (для minDays)
	while (availableDays.length < minDays && availableDays.length < results.length) {
		const next = results[availableDays.length]
		if (next) availableDays.push(next.day)
		else break
	}

	return availableDays
}

// --- Получение слотов ---
export async function getAvailableSlotsForDay(day: DateTime) {
	const slots: { start: DateTime; label: string }[] = []
	const startHour = 11
	const endHour = 19
	const meetingDuration = 60 // мин
	const breakAfterMeeting = 0 // мин
	const maxMeetingsPerDay = 8

	const slotTimes: DateTime[] = []
	let slotStart = day.set({
		hour: startHour,
		minute: 0,
		second: 0,
		millisecond: 0,
	})

	for (let i = 0; i < maxMeetingsPerDay; i++) {
		const slotEnd = slotStart.plus({ minutes: meetingDuration })
		if (slotStart.hour >= endHour) break
		slotTimes.push(slotStart)
		slotStart = slotEnd.plus({ minutes: breakAfterMeeting })
	}

	// ⚡ Параллельные запросы для всех слотов
	const slotResults = await Promise.all(
		slotTimes.map(async (slotStart) => {
			const slotEnd = slotStart.plus({ minutes: meetingDuration })
			const res = await calendar.events.list({
				calendarId: CALENDAR_ID,
				timeMin: slotStart.toISO(),
				timeMax: slotEnd.toISO(),
				singleEvents: true,
				orderBy: 'startTime',
			} as calendar_v3.Params$Resource$Events$List)

			const events = res.data.items || []
			return {
				start: slotStart,
				free: events.length === 0,
			}
		})
	)

	for (const s of slotResults) {
		if (s.free) {
			slots.push({
				start: s.start,
				label: s.start.toFormat('HH:mm'),
			})
		}
	}

	return slots
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
	if (contact?.phone_number) {
		session.phone = contact.phone_number
    session.waitingPhone = false
		session.waitingEmail = true
		sessions.set(userId, session)
		ctx.reply('Дякую! тепер введіть email на який буде надіслано запрошення:')
	}
}

// tell phone number check
export function isValidPhone(phone: string) {
  // убираем пробелы и дефисы для проверки
  const cleaned = phone.replace(/[\s-]/g, '');

  // проверяем на цифры и максимум один +
  if (/[^+\d]/.test(cleaned)) return false; // есть буквы или другие символы
  if ((cleaned.match(/\+/g) || []).length > 1) return false; // больше одного +
  if (!/^\+?\d{9,15}$/.test(cleaned)) return false; // длина номера
  return true
}
