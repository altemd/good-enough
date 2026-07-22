import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "#/lib/utils";

export function ModelMarkdown({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"prose prose-sm max-w-none break-words prose-a:text-foreground prose-a:underline prose-a:underline-offset-4 prose-code:break-words prose-pre:max-w-full prose-pre:overflow-x-auto",
				className,
			)}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				skipHtml
				components={{
					a: ({ children: linkChildren, ...props }) => (
						<a {...props} target="_blank" rel="noreferrer">
							{linkChildren}
						</a>
					),
					img: ({ alt }) => (
						<span className="text-muted-foreground">
							[Remote image omitted{alt ? `: ${alt}` : ""}]
						</span>
					),
				}}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
}
