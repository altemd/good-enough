import type { ReactNode } from "react";

import { cn } from "#/lib/utils";

interface ConsoleFrameProps {
	title: string;
	action?: ReactNode;
	className?: string;
	children: ReactNode;
}

function ConsoleFrame({
	title,
	action,
	className,
	children,
}: ConsoleFrameProps) {
	return (
		<section
			className={cn(
				"overflow-hidden rounded-2xl border border-terminal-border bg-terminal text-terminal-fg shadow-sm",
				className,
			)}
			aria-label={title}
		>
			<header className="flex items-center border-b border-terminal-border px-4 py-3">
				<div className="flex gap-1.5" aria-hidden="true">
					<span className="size-2.5 rounded-full bg-terminal-error" />
					<span className="size-2.5 rounded-full bg-terminal-warning" />
					<span className="size-2.5 rounded-full bg-terminal-success" />
				</div>
				<p className="ml-3 font-mono text-xs text-terminal-muted">{title}</p>
				{action ? <div className="ml-auto">{action}</div> : null}
			</header>
			{children}
		</section>
	);
}

export { ConsoleFrame };
