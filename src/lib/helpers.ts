import { calendar } from '@/app/api/telegram-bot/route'
import { DateTime } from 'luxon'
import { TIMEZONE } from './vars'

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!

// --- Получение доступных дней ---
export async function getAvailableDays(daysAhead = 30, minDays = 10) {
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
export async function getAvailableSlotsForDay(day: DateTime) {
  console.log('I am executed!!!!!!!!!!!!')
	const slots: { start: DateTime; label: string }[] = []
	const startHour = 11
	const endHour = 19
	const meetingDuration = 60 // мин
	const breakAfterMeeting = 0 // мин
	const maxMeetingsPerDay = 8

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
      // @ts-expect-error type error
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
