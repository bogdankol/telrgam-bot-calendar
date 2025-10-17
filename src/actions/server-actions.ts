'use server'

import { calendar_v3 } from 'googleapis'
import { DateTime } from 'luxon'
// import { TCheckInvoiceStatus, TPaymentGeneratedLink } from '@/lib/types'
// import { envCheck } from '@/utils/server-utils'

// const MONO_API_TOKEN = process.env.MONO_API_TOKEN_TEST!
// const MONO_BASIC_URL = process.env.MONO_API_BASIC_URL!
// const PROJECT_URL = process.env.BASIC_URL!

// export async function createNewInvoiceLink(): Promise<TPaymentGeneratedLink | undefined> {

//   const allEnvIsPresent = await envCheck()
//   console.log({allEnvIsPresent})
//   if(!allEnvIsPresent) {
//     throw Error('Some error occurred')
//   }

//   const MONO_BASIC_URL = process.env.MONO_API_BASIC_URL!
//   const monoToken = process.env.MONO_API_TOKEN_TEST!
//   const fee = process.env.FEE_FOR_SERVICE_IN_GRN!

//   const sumInCopiyka = Number(fee) * 100

//   try {
//     const res = await fetch(MONO_BASIC_URL + 'api/merchant/invoice/create', {
//       method: "POST",
//       headers: {
//         'Content-Type': 'application/json',
//         'X-Token': monoToken
//       },
//       body: JSON.stringify({
//         amount: sumInCopiyka,
//         webhookUrl: PROJECT_URL + `/api/mono-webhook`
//       })
//     })

//     const response: TPaymentGeneratedLink = await res.json()
//     console.log({ response })
//     return response
//   } catch(err: unknown) {
//     console.error('Invoice creation error:', err instanceof Error ? err.message : err)
//     return
//   }

// }

// export async function getStatusOfInvoiceById(id: string): Promise<TCheckInvoiceStatus | undefined> {
//   await envCheck()

//   try {
//     const res = await fetch(MONO_BASIC_URL + `api/merchant/invoice/status?invoiceId=${id}`, {
//       method: 'GET',
//       headers: {
//         'Content-Type': 'application/json',
//         'X-Token': MONO_API_TOKEN
//       }
//     })
//     const response: TCheckInvoiceStatus = await res.json()
//     return response
//   } catch(err: unknown) {
//     console.error('Invoice creation error:', err instanceof Error ? err.message : err)
//     return
//   }
// }

export async function getUpcomingMeetings(userId: string, timezone: string, calendar: calendar_v3.Calendar, calendar_id: string, ctx: any) {
	try {
		// Берём текущую дату и диапазон 2 недели вперёд
		const now = DateTime.now().setZone(timezone)
		const twoWeeksLater = now.plus({ weeks: 2 })

		// Получаем все события за период
		const res = await calendar.events.list({
			calendarId: calendar_id,
			timeMin: now.toISO(),
			timeMax: twoWeeksLater.toISO(),
			singleEvents: true,
			orderBy: 'startTime',
		} as calendar_v3.Params$Resource$Events$List)

		const events = res?.data?.items || []

		console.log({ events })

		// Фильтруем по clientId
		const userEvents = events.filter(ev =>
			ev.description?.includes(`clientId: ${userId}`),
		)

		if (userEvents.length === 0) {
			return await ctx.reply(
				'❌ У вас немає запланованих зустрічей на наступні 2 тижні.',
			)
		}

		// Форматируем список для отправки
		const message = userEvents
			.map(ev => {
				const startISO = ev.start?.dateTime || ev.start?.date
				const start = startISO
					? DateTime.fromISO(startISO)
							.setZone(timezone)
							.toFormat('dd.MM.yyyy HH:mm')
					: 'невідомо'
				return `📅 ${start}\n Формат зустрічі: ${
					ev.description?.match(/Фoрмат зустрічі: (.*)/)?.[1] ||
					'необхідне уточнення'
				}`
			})
			.join('\n\n')

		await ctx.reply(`Ось ваші мітинги на найближчі 2 тижні:\n\n${message}`)
		await ctx.reply(
			`Для початку роботи натисніть /start. Для того, щоб повторно отримати дані про майбутні зустрічі натисніть /get_meetings`,
		)
	} catch (err) {
		console.error('Помилка отримання подій:', err)
		await ctx.reply(
			'⚠️ Сталася помилка під час отримання мітингів. Спробуйте пізніше.',
		)
	}
}
