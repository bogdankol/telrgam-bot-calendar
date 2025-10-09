import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma' 
import { Invoice } from '@prisma/client'
import { TCheckInvoiceStatus } from '@/lib/types'

export async function POST(req: NextRequest) {
  const body: TCheckInvoiceStatus = await req.json()

  if(!body) return console.error(' Nothing came to body')

  console.log('I am webhook', { body })
  const {
    invoiceId,
    status,
    failureReason,
    errCode,
    amount,
    ccy,
    finalAmount,
    createdDate,
    modifiedDate,
    paymentInfo
  } = body

  const obj:Omit<Invoice, 'id'> = {
    invoiceId,
    status,
    failureReason: failureReason ?? '',
    errCode: errCode ?? '',
    amount_in_kopiyka: amount,
    ccy_TypeOfMoneyCurrency: ccy,
    finalAmount_in_kopiyka: finalAmount,
    invoiceDateOfCreation: createdDate,
    invoiceDateOfUpdate: modifiedDate,
    otherPaymentInfo: JSON.stringify(paymentInfo)
  }

  try {
    const res = await prisma.invoice.create({
      data: obj
    })

    return NextResponse.json({ message: 'success' })
  } catch(err: unknown) {
    return console.error('Error during putting invoiceData in db', {err})
  }
}

// left it for test if any issue occurred
// export async function GET() {
//   const testInvoice: Omit<Invoice, 'id'> = {
//     invoiceId: 'INV-TEST-001',
//     status: 'PENDING',
//     failureReason: '',
//     errCode: '',
//     amount: 1000,
//     ccy: 840, // USD
//     finalAmount: 1000,
//     createdDate: new Date(),
//     modifiedDate: new Date(),
//     paymentInfo: 'Test payment info',
//   }
//   try {
//     const testInv = await prisma.invoice.create({
//       data: testInvoice
//     })

//     return NextResponse.json({message: 'created', testInv})
//   } catch(err: unknown) {
//     return NextResponse.json({ message: 'error', err})
//   }
// }