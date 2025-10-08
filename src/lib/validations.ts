import { z } from 'zod'

export const zodSchema = z.object({
  invoiceId: z.string().min(1)
})

export type TZodSchema = z.infer<typeof zodSchema>