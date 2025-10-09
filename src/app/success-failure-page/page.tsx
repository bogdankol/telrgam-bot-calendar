import Content from './content'

export default async function Page({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {

  const success = (await searchParams )?.success
  return <Content success={success === 'true'} />
}