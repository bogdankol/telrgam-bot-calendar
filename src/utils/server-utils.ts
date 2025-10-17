'use server'

export async function envCheck() {
	// const monoKeyAvailable = !!process.env.MONO_API_TOKEN_TEST
	// const monoBasicUrlAvailable = !!process.env.MONO_API_BASIC_URL
	const telegramEventsBotToken = !!process.env.TELEGRAM_EVENTS_BOT_TOKEN
	const myCalendarId = !!process.env.GOOGLE_CALENDAR_MY_ID
	const googleServiceClientMail = !!process.env.GOOGLE_CLIENT_EMAIL
	const googlePrivateKey = !!process.env.GOOGLE_PRIVATE_KEY
	const basicUrl = !!process.env.BASIC_URL
	// const fee = !!process.env.FEE_FOR_SERVICE_IN_GRN
	const db = !!process.env.DATABASE_URL
	const adminId = !!process.env.BOT_ADMIN_ID
	const telegramNotificationBotToken =  !!process.env.TELEGRAM_NOTIFICATION_BOT_TOKEN
  const googleCalendarWorkId = !!process.env.GOOGLE_CALENDAR_WORK_ID

  console.log({
    myCalendarId,
  })

	if (
		// !monoKeyAvailable ||
		// !monoBasicUrlAvailable ||
		!telegramEventsBotToken ||
		!myCalendarId ||
		!googlePrivateKey ||
		!googleServiceClientMail ||
		!basicUrl ||
		// !fee ||
		!db ||
		!adminId ||
		!telegramNotificationBotToken ||
    !googleCalendarWorkId
	) {
		console.error('One of variables is missing')
		return
	}

	return true
}

export async function checkNotificationBotAvailability() {
	const TELEGRAM_NOTIFICATION_BOT_TOKEN =
		process.env.TELEGRAM_NOTIFICATION_BOT_TOKEN!
	const ADMIN_ID = process.env.BOT_ADMIN_ID!
	const apiBase = `https://api.telegram.org/bot${TELEGRAM_NOTIFICATION_BOT_TOKEN}`

	try {
		// отправляем тихое сообщение
		const sendRes = await fetch(`${apiBase}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: ADMIN_ID,
				text: '🔕 Тестове повідомлення для перевірки доступу (без звуку).',
				disable_notification: true,
			}),
		})

		const sendData = await sendRes.json()

		if (!sendData.ok) {
			console.error('⚠️ sendMessage returned not ok:', sendData)
			return false
		}

		const messageId = sendData.result?.message_id
		if (!messageId) {
			console.error('⚠️ No message_id in sendMessage result')
			return false
		}

		// пробуем удалить тестовое сообщение, чтобы не оставлять след
		try {
			await fetch(`${apiBase}/deleteMessage`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					chat_id: ADMIN_ID,
					message_id: messageId,
				}),
			})
		} catch (deleteErr) {
			console.warn('Не удалось удалить тестовое сообщение:', deleteErr)
		}

		console.log('✅ Notification bot is available and can send messages.')
		return true
	} catch (err: unknown) {
		const errorText = (err as any)?.message || 'Unknown error'
		console.error('❌ Error during notification bot check:', errorText)
		return false
	}
}
