'use client'

export default function Page() {
  return <div>Disabled for now</div>
}
// import ButtonCustom from '@/components/Button'
// import { useEffect, useState, useTransition } from 'react'
// import { TCheckInvoiceStatus } from '@/lib/types'
// import InputCustom from '@/components/Input'
// import { getStatusOfInvoiceById } from '@/actions/server-actions'
// import { useForm } from 'react-hook-form'
// import {
// 	Form,
// 	FormControl,
// 	FormField,
// 	FormItem,
// 	FormLabel,
// 	FormMessage,
// } from '@/components/shadcn/form'
// import { zodSchema } from '@/lib/validations'
// import { zodResolver } from '@hookform/resolvers/zod'
// import { transformIntoArrayOfCortages } from '@/lib/client-helpers'

// export default function Page({ invoiceId }: { invoiceId?: string }) {
// 	const [invoiceStatus, setInvoiceStatus] = useState<TCheckInvoiceStatus>()
// 	const [isPending, startTransition] = useTransition()

// 	const formHook = useForm({
// 		resolver: zodResolver(zodSchema),
// 		defaultValues: {
// 			invoiceId: invoiceId ?? '',
// 		},
// 	})

// 	const { getValues, trigger } = formHook

// 	async function onSubmitHandler() {
// 		startTransition(async () => {
//       if(invoiceId) {
//         const res = await getStatusOfInvoiceById(invoiceId)
//         if (!res) throw Error('An error occurred')

//         setInvoiceStatus(res)
//         transformIntoArrayOfCortages(res)
//         return
//       }

// 			const resultOfValidation = await trigger()
// 			if (!resultOfValidation) return
// 			const { invoiceId: inputInvoiceId } = getValues()

// 			const res = await getStatusOfInvoiceById(inputInvoiceId)
// 			if (!res) throw Error('An error occurred')

// 			setInvoiceStatus(res)
// 			transformIntoArrayOfCortages(res)
// 		})
// 	}

//   useEffect(() => {
//     async function f() {
//       await onSubmitHandler()
//     }
//     if(invoiceId) {
//       f()
//     }
//   }, [invoiceId])

// 	return (
// 		<div className='flex space-x-5 p-5'>
// 			<div className='w-1/2 space-y-4'>
// 				<Form {...formHook}>
// 					<form
// 						onSubmit={formHook.handleSubmit(onSubmitHandler)}
// 						className='space-y-4'
// 					>
// 						<FormField
// 							{...{
// 								render: ({ field }) => (
// 									<FormItem>
// 										<FormLabel>Invoice Id</FormLabel>
// 										<FormControl>
// 											<InputCustom
// 												placeholder='Enter invoice Id...'
// 												{...field}
// 											/>
// 										</FormControl>
// 										<FormMessage />
// 									</FormItem>
// 								),
// 								name: 'invoiceId',
// 							}}
// 						/>

// 						<ButtonCustom
// 							text='Check invoice*s status'
// 							type='submit'
// 							disabled={isPending}
// 						/>
// 					</form>
// 				</Form>
// 			</div>
// 			<div className='w-1/2'>
// 				{invoiceStatus && (
// 					<ul className='border-4 border-blue-800 p-4 w-full'>
// 						{transformIntoArrayOfCortages(invoiceStatus).map((cortage: any, i: number) => (
// 							<li key={i}>
// 								{cortage[0]}:{' '}
// 								{typeof cortage[1] !== 'object' ? (
// 									cortage[1]
// 								) : (
// 									<ul className='ml-4'>
// 										{cortage[1].map(
// 											([k, v]: [string, string | number | Date]) => (
// 												<li key={k}>
// 													{k}: {v instanceof Date ? v.toLocaleString() : v}
// 												</li>
// 											),
// 										)}
// 									</ul>
// 								)}
// 							</li>
// 						))}
// 					</ul>
// 				)}
// 			</div>
// 		</div>
// 	)
// }
