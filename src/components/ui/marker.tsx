import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Marker({
	className,
	render,
	...props
}: useRender.ComponentProps<"div">) {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn(
					"group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-sm text-muted-foreground [&_svg:not([class*='size-'])]:size-4 [a]:underline [a]:underline-offset-3 [a]:hover:text-foreground",
					className,
				),
			},
			props,
		),
		render,
		state: {
			slot: "marker",
		},
	});
}

function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="marker-icon"
			aria-hidden="true"
			className={cn(
				"size-4 shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		/>
	);
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="marker-content"
			className={cn(
				"min-w-0 wrap-break-word *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export { Marker, MarkerIcon, MarkerContent };
