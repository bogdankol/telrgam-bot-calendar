'use server'

export async function envCheck() {
	// const monoKeyAvailable = !!process.env.MONO_API_TOKEN_TEST
	// const monoBasicUrlAvailable = !!process.env.MONO_API_BASIC_URL
	const telegramToken = !!process.env.TELEGRAM_BOT_TOKEN
	const calendarId = !!process.env.GOOGLE_CALENDAR_ID
	const googleServiceClientMail = !!process.env.GOOGLE_CLIENT_EMAIL
	const googlePrivateKey = !!process.env.GOOGLE_PRIVATE_KEY
  const basicUrl = !!process.env.BASIC_URL
  // const fee = !!process.env.FEE_FOR_SERVICE_IN_GRN
  const db = !!process.env.DATABASE_URL
  const adminId = !!process.env.BOT_ADMIN_ID

	if (
		// !monoKeyAvailable ||
		// !monoBasicUrlAvailable ||
		!telegramToken ||
		!calendarId ||
		!googlePrivateKey ||
		!googleServiceClientMail ||
    !basicUrl ||
    // !fee ||
    !db ||
    !adminId
	) {
		console.error('One of variables is missing')
    return 
  }

	return true
}
