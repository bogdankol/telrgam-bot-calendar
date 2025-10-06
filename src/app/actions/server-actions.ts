import { TPaymentGeneratedLink } from '@/lib/types'

export async function createNewInvoiceLink() {
  const monoBasicUrl = process.env.MONO_API_BASIC_URL!
  const monoToken = process.env.MONO_API_TOKEN_TEST!

  try {
    const res = await fetch(monoBasicUrl + 'api/merchant/invoice/create', {
      method: "POST",
      headers: {
        'Content-Type': 'application/json',
        'X-Token': monoToken
      },
      body: JSON.stringify({
        amount: 2000,
        redirectUrl: `https://mono-api-test.vercel.app/success-page?userId=sdqwdsaffdad&date=${Date.now()}`,
        webhookUrl: `https://mono-api-test.vercel.app/api/mono-webhook`
      })
    })

    const response: TPaymentGeneratedLink = await res.json()
    console.log({ response })
    return response
  } catch(err: unknown) {
    console.error('Invoice creation error:', err instanceof Error ? err.message : err)
    return
  }

}