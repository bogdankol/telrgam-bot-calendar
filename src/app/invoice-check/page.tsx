import Content from './content'

export default async function Page({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {

  const invoiceId = (await searchParams )?.invoiceId as string
  return <Content invoiceId={invoiceId} />
}