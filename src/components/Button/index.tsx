import { Button } from '@/components/shadcn/button'

type TProps = {
	onClick?: () => Promise<void>
	text: string
	className?: string
	type?: 'submit'
	disabled?: boolean
}

export default function ButtonCustom({
	onClick,
	text,
	className,
	type,
	disabled,
}: TProps) {
	return (
		<Button
			disabled={disabled}
			type={type}
			onClick={onClick}
			className={className}
		>
			{text}
		</Button>
	)
}
