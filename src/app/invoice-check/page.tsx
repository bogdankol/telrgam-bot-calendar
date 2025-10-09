import Content from './content'

export default async function Page({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {

  const invoiceId = (await searchParams )?.invoiceId

  if(typeof(invoiceId) !== 'string') throw Error('Wrong invoiceId dataFormat')
    
  return <Content invoiceId={invoiceId} />
}