'use client'

import { createNewInvoiceLink } from '@/actions/server-actions'
import ButtonCustom from '@/components/Button'
import { TPaymentGeneratedLink } from '@/lib/types'
import { invoiceCheckUrl } from '@/lib/vars'
import Link from 'next/link'
import { useState } from 'react'
import { toast, Toaster } from 'sonner'

export default function Page() {
	const [newInvoiceData, setNewInvoiceData] = useState<TPaymentGeneratedLink>()

	async function onClickHandler() {
		const res = await createNewInvoiceLink()
		if (res?.pageUrl) {
			setNewInvoiceData(res)
		}
	}

	return (
		<div className='flex space-x-5 border-4 border-b-blue-950 mt-5 p-5 space-y-5'>
			<Toaster
				closeButton
				duration={2000}
				gap={500}
				position='top-center'
				toastOptions={{
					style: {
						borderRadius: '8px',
						fontWeight: 500,
						padding: '12px 16px',
						boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
						fontFamily: 'Roboto, sans-serif',
						border: '2px solid #4CAF50',
						backgroundColor: '#E8F5E9',
						color: '#1B5E20',
					},
				}}
			/>
			<div>
				<ButtonCustom
					text='Create new invoice'
					onClick={onClickHandler}
				/>
			</div>
			{newInvoiceData && (
				<ul className='space-y-5'>
					<li className='text-[18px] text-emerald-900 border-4 border-black p-2'>
						<span className='font-bold text-black'>InvoiceId:</span>{' '}
						{newInvoiceData?.invoiceId}
					</li>
					<li
						className='text-[18px] text-emerald-900 border-4 border-black hover:cursor-pointer  p-2'
						onClick={() => {
							navigator.clipboard.writeText(newInvoiceData.pageUrl)
							toast.info('Copied!')
						}}
					>
						<span className='font-bold text-black'>
							PaymentLink (click to copy):
						</span>{' '}
						{newInvoiceData?.pageUrl}
					</li>
					<li className='text-[18px] text-emerald-900 border-4 border-black hover:cursor-pointer  p-2'>
						<Link
							href={`${invoiceCheckUrl}?invoiceId=${newInvoiceData.invoiceId}`}
						>
							<span  className='font-bold text-black'>Status check: </span>For to check new invoice status proceed click me!
						</Link>
					</li>
				</ul>
			)}
		</div>
	)
}
