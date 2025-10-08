import { Input } from '../shadcn/input'

export default function InputCustom({
  className,
  placeholder,
  ...props
}: {
  className?: string
  placeholder: string
}) {
  return <Input className={className} placeholder={placeholder} {...props} />
}