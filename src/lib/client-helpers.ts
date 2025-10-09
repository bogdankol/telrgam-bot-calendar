'use client'

export function transformIntoArrayOfCortages<T extends Record<string, any>>(
	obj: T,
) {
	const arr = Object.entries(obj)

	const arrWithInnerCortages = arr.map(cortage => {
		if (typeof cortage[1] !== 'object') return cortage
		return [cortage[0], Object.entries(cortage[1])]
	})

	return arrWithInnerCortages
}
