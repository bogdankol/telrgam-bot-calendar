'use server'
import { TCheckInvoiceStatus, TPaymentGeneratedLink } from '@/lib/types'
import { envCheck } from '@/utils/server-utils'

const monoKey = process.env.MONO_API_TOKEN_TEST!
const monoBasicUrl = process.env.MONO_API_BASIC_URL!

export async function createNewInvoiceLink(): Promise<TPaymentGeneratedLink | undefined> {

  const allEnvIsPresent = await envCheck()
  console.log({allEnvIsPresent})
  if(!allEnvIsPresent) {
    throw Error('Some error occurred')
  }
  
  const monoBasicUrl = process.env.MONO_API_BASIC_URL!
  const monoToken = process.env.MONO_API_TOKEN_TEST!
  const fee = process.env.FEE_FOR_SERVICE_IN_GRN!

  const sumInCopiyka = Number(fee) * 100

  try {
    const res = await fetch(monoBasicUrl + 'api/merchant/invoice/create', {
      method: "POST",
      headers: {
        'Content-Type': 'application/json',
        'X-Token': monoToken
      },
      body: JSON.stringify({
        amount: sumInCopiyka,
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

export async function getStatusOfInvoiceById(id: string): Promise<TCheckInvoiceStatus | undefined> {
  await envCheck()
  
  try {
    const res = await fetch(monoBasicUrl + `api/merchant/invoice/status?invoiceId=${id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': monoKey
      }
    })
    const response: TCheckInvoiceStatus = await res.json()
    return response
  } catch(err: unknown) {
    console.error('Invoice creation error:', err instanceof Error ? err.message : err)
    return 
  }
}