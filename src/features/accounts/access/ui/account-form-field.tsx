import type { ComponentProps } from "react";

import { cn } from "#/lib/utils";

export function AccountFormField({
	label,
	className,
	...inputProps
}: ComponentProps<"input"> & { label: string }) {
	return (
		<label>
			{label}
			<input
				className={cn("block w-full rounded border p-2", className)}
				{...inputProps}
			/>
		</label>
	);
}
