import type * as React from "react";

import { cn } from "#/lib/utils";

function Input({ className, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			data-slot="input"
			className={cn(
				"flex h-8 w-full min-w-0 rounded-2xl border border-transparent bg-input/50 px-2.5 text-sm transition-[color,box-shadow] duration-200 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
