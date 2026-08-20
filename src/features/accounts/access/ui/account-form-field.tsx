import type { ComponentProps } from "react";

import { Input } from "#/components/ui/input";
import { cn } from "#/lib/utils";

export function AccountFormField({
	label,
	name,
	id,
	className,
	...inputProps
}: ComponentProps<"input"> & { label: string }) {
	const fieldId = id ?? name;
	return (
		<div className="grid gap-1.5 text-sm font-medium">
			<label htmlFor={fieldId}>{label}</label>
			<Input
				id={fieldId}
				name={name}
				className={cn("font-normal", className)}
				{...inputProps}
			/>
		</div>
	);
}
