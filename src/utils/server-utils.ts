'use server'

import { Telegraf } from 'telegraf'

export async function envCheck() {
	// const monoKeyAvailable = !!process.env.MONO_API_TOKEN_TEST
	// const monoBasicUrlAvailable = !!process.env.MONO_API_BASIC_URL
	const telegramEventsBotToken = !!process.env.TELEGRAM_EVENTS_BOT_TOKEN
	const calendarId = !!process.env.GOOGLE_CALENDAR_ID
	const googleServiceClientMail = !!process.env.GOOGLE_CLIENT_EMAIL
	const googlePrivateKey = !!process.env.GOOGLE_PRIVATE_KEY
	const basicUrl = !!process.env.BASIC_URL
	// const fee = !!process.env.FEE_FOR_SERVICE_IN_GRN
	const db = !!process.env.DATABASE_URL
	const adminId = !!process.env.BOT_ADMIN_ID
	const telegramNotificationBotToken =
		!!process.env.TELEGRAM_NOTIFICATION_BOT_TOKEN

	if (
		// !monoKeyAvailable ||
		// !monoBasicUrlAvailable ||
		!telegramEventsBotToken ||
		!calendarId ||
		!googlePrivateKey ||
		!googleServiceClientMail ||
		!basicUrl ||
		// !fee ||
		!db ||
		!adminId ||
		!telegramNotificationBotToken
	) {
		console.error('One of variables is missing')
		return
	}

	return true
}

export async function checkNotificationBotAvailability() {
  const TELEGRAM_NOTIFICATION_BOT_TOKEN = process.env.TELEGRAM_NOTIFICATION_BOT_TOKEN!
  const ADMIN_ID = process.env.BOT_ADMIN_ID!
  const notification_bot = new Telegraf(TELEGRAM_NOTIFICATION_BOT_TOKEN)

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_NOTIFICATION_BOT_TOKEN}/getChat?chat_id=${ADMIN_ID}`)
    const data = await res.json()
    console.log({data})
  } catch(err: unknown) {
    throw Error(`Error with notification bot:, ${err}`)
  }
}
