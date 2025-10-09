export type TPaymentGeneratedLink = { invoiceId: string; pageUrl: string }
export type TCheckInvoiceStatus = {
  invoiceId: string 
  status: 'created' | 'processing' | 'hold' | 'success' | 'failure' | 'reversed' | 'expired'
  failureReason?: string
  errCode?: string
  amount: number
  ccy: number
  finalAmount: number
  createdDate: Date
  modifiedDate: Date
  reference: string
  destination: string
  cancelList?: {
    status: 'processing' | 'success' | 'failure',
    amount: number,
    ccy: number,
    createdDate: Date,
    modifiedDate: Date,
    approvalCode: string,
    rrn: string,
    extRef: string
  }[],
  paymentInfo?: {
    maskedPan: string,
    approvalCode: string,
    rrn: string,
    tranId: string,
    terminal: string,
    bank: string,
    paymentSystem: string,
    paymentMethod: 'pan' | 'apple' | 'google' | 'monobank' | 'wallet' | 'direct',
    fee: number,
    country: string,
    agentFee: number
  },
}