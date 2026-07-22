import { Bot } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { type DemoChatMessage, DemoChatMessageView } from "./demo-chat-message";

const BOTTOM_PROXIMITY_PX = 48;

export function DemoChatTranscript({
	messages,
	forceScrollKey,
}: {
	messages: DemoChatMessage[];
	forceScrollKey: number;
}) {
	const viewport = useRef<HTMLDivElement>(null);
	const followsLatest = useRef(true);
	const previousForceScrollKey = useRef(forceScrollKey);

	useLayoutEffect(() => {
		const element = viewport.current;
		if (!element) return;
		if (previousForceScrollKey.current !== forceScrollKey) {
			previousForceScrollKey.current = forceScrollKey;
			followsLatest.current = true;
		}
		if (followsLatest.current) element.scrollTop = element.scrollHeight;
	});

	return (
		<div
			ref={viewport}
			className="h-[min(56vh,34rem)] min-h-80 space-y-5 overflow-y-auto overscroll-contain bg-muted/20 p-5 sm:p-7"
			role="log"
			aria-label="Demo conversation"
			aria-live="polite"
			aria-relevant="additions text"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the bounded transcript.
			tabIndex={0}
			onScroll={(event) => {
				const element = event.currentTarget;
				const distanceFromBottom =
					element.scrollHeight - element.clientHeight - element.scrollTop;
				followsLatest.current = distanceFromBottom <= BOTTOM_PROXIMITY_PX;
			}}
		>
			{messages.length === 0 ? (
				<EmptyState
					icon={<Bot />}
					title="Ask the local model"
					body="Responses stream into this page and are not saved by the service."
				/>
			) : null}
			{messages.map((message) => (
				<DemoChatMessageView key={message.id} message={message} />
			))}
		</div>
	);
}

function EmptyState({
	icon,
	title,
	body,
}: {
	icon: React.ReactNode;
	title: string;
	body: string;
}) {
	return (
		<div className="flex min-h-80 flex-col items-center justify-center text-center">
			<span className="flex size-11 items-center justify-center rounded-2xl border bg-background text-muted-foreground [&_svg]:size-5">
				{icon}
			</span>
			<p className="mt-4 font-medium">{title}</p>
			<p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
				{body}
			</p>
		</div>
	);
}
