import { useEffect, useRef, useState } from "react";

import { badgeVariants } from "#/components/ui/badge";
import { ConsoleFrame } from "#/components/ui/console-frame";
import { PageLayout } from "#/components/ui/page-layout";
import { cn } from "#/lib/utils";

import {
	PERSONAL_CONSOLE_EVENT_NAMES,
	type PersonalConsoleLine,
	projectPersonalConsoleEvent,
} from "../personal-console-events";

export const PERSONAL_CONSOLE_MAX_LINES = 200;

type ConnectionState = "connecting" | "disconnected" | "live";

export interface PersonalConsoleEventSource {
	addEventListener(
		type: string,
		listener: (event: MessageEvent<string>) => void,
	): void;
	close(): void;
	onerror: ((event: Event) => void) | null;
	onopen: ((event: Event) => void) | null;
}

export type PersonalConsoleEventSourceFactory = (
	url: string,
) => PersonalConsoleEventSource;

interface RenderedLine extends PersonalConsoleLine {
	readonly key: number;
}

export function PersonalLiveConsolePage({
	createEventSource = defaultEventSourceFactory,
}: {
	createEventSource?: PersonalConsoleEventSourceFactory;
}) {
	const [connection, setConnection] = useState<ConnectionState>("connecting");
	const [lines, setLines] = useState<RenderedLine[]>([]);
	const [connectionAttempt, setConnectionAttempt] = useState(0);
	const nextKey = useRef(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the counter intentionally restarts the connection after an explicit reconnect request.
	useEffect(() => {
		const source = createEventSource("/api/live-console/events");
		let active = true;
		setConnection("connecting");
		const append = (line: PersonalConsoleLine) => {
			if (!active) return;
			nextKey.current += 1;
			const renderedLine = { ...line, key: nextKey.current };
			setLines((current) =>
				[...current, renderedLine].slice(-PERSONAL_CONSOLE_MAX_LINES),
			);
		};

		for (const eventName of PERSONAL_CONSOLE_EVENT_NAMES) {
			source.addEventListener(eventName, (event) => {
				const line = projectPersonalConsoleEvent(eventName, event.data);
				if (line) append(line);
			});
		}
		source.onopen = () => {
			if (active) setConnection("live");
		};
		source.onerror = () => {
			if (!active) return;
			active = false;
			source.close();
			setConnection("disconnected");
		};

		return () => {
			active = false;
			source.close();
		};
	}, [createEventSource, connectionAttempt]);

	return (
		<PageLayout title="Live inference console">
			<div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
				<ConnectionBadge state={connection} />
				{connection === "disconnected" ? (
					<button
						type="button"
						className="rounded font-medium underline underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
						onClick={() => setConnectionAttempt((attempt) => attempt + 1)}
					>
						Try to reconnect
					</button>
				) : null}
			</div>
			<p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
				Only live requests authenticated with your personal API keys appear
				here. Prompts, responses, reasoning, credentials, and raw server output
				are never included. Request timing is live-only: it is not saved or
				replayed. Refreshing clears this tab.
			</p>

			<ConsoleFrame
				title={`personal / live-only / max ${PERSONAL_CONSOLE_MAX_LINES} lines`}
				className="mt-6"
				action={
					lines.length > 0 ? (
						<button
							className="rounded text-xs text-terminal-muted underline decoration-terminal-faint underline-offset-4 hover:text-terminal-fg focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
							type="button"
							onClick={() => setLines([])}
						>
							Clear this tab
						</button>
					) : undefined
				}
			>
				{lines.length === 0 ? (
					<div className="px-5 py-16 text-center font-mono">
						<p className="text-sm text-terminal-fg">
							Waiting for a personal request…
						</p>
						<p className="mt-2 text-xs text-terminal-faint">
							This page starts empty; past activity is not replayed.
						</p>
					</div>
				) : null}
				<ol
					aria-live="polite"
					className="max-h-[32rem] overflow-y-auto p-2 font-mono text-xs"
				>
					{lines.map((line) => (
						<ConsoleLine key={line.key} line={line} />
					))}
				</ol>
			</ConsoleFrame>
		</PageLayout>
	);
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
	const tones = {
		connecting: "warning",
		disconnected: "error",
		live: "info",
	}[state] as "warning" | "error" | "info";
	return (
		<output className={cn(badgeVariants({ tone: tones }), "gap-1 px-3 py-1")}>
			<span aria-hidden="true">● </span>
			{state}
		</output>
	);
}

function ConsoleLine({ line }: { line: RenderedLine }) {
	return (
		<li className="grid gap-1 rounded-lg px-3 py-2 hover:bg-terminal-hover sm:grid-cols-[5.5rem_minmax(0,1fr)]">
			<div className="text-terminal-faint">
				{line.occurredAt ? (
					<time dateTime={line.occurredAt}>
						{formatUtcClock(line.occurredAt)}
					</time>
				) : (
					"--:--:--"
				)}
			</div>
			<div className="min-w-0">
				<p className={toneClassName(line.tone)}>
					<span className="font-semibold">{line.title}</span>
					{line.requestId ? (
						<span className="ml-2 break-all text-terminal-faint">
							{line.requestId}
						</span>
					) : null}
				</p>
				<p className="mt-1 break-words text-terminal-muted">
					{line.details.join(" · ")}
				</p>
			</div>
		</li>
	);
}

function toneClassName(tone: PersonalConsoleLine["tone"]): string {
	return {
		activity: "text-terminal-info",
		error: "text-terminal-error",
		muted: "text-terminal-fg",
		success: "text-terminal-success",
		warning: "text-terminal-warning",
	}[tone];
}

function formatUtcClock(value: string): string {
	return `${value.slice(11, 19)}Z`;
}

function defaultEventSourceFactory(url: string): PersonalConsoleEventSource {
	return new EventSource(url);
}
