import { useEffect, useRef, useState } from "react";

import { AccountPageLayout } from "#/features/accounts/ui/account-page-layout";
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
	const nextKey = useRef(0);

	useEffect(() => {
		const source = createEventSource("/api/live-console/events");
		let active = true;
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
	}, [createEventSource]);

	return (
		<AccountPageLayout title="Live inference console">
			<div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
				<ConnectionBadge state={connection} />
			</div>
			<p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">
				Only live requests authenticated with your personal API keys appear
				here. Prompts, responses, reasoning, credentials, and raw server output
				are never included. Request timing is live-only: it is not saved or
				replayed. Refreshing clears this tab.
			</p>

			<section
				aria-label="Personal live inference activity"
				className="mt-6 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-slate-100 shadow-sm"
			>
				<header className="flex items-center border-b border-slate-800 px-4 py-3">
					<div className="flex gap-1.5" aria-hidden="true">
						<span className="size-2.5 rounded-full bg-rose-400" />
						<span className="size-2.5 rounded-full bg-amber-300" />
						<span className="size-2.5 rounded-full bg-emerald-400" />
					</div>
					<p className="ml-3 font-mono text-xs text-slate-400">
						personal / live-only / max {PERSONAL_CONSOLE_MAX_LINES} lines
					</p>
					{lines.length > 0 ? (
						<button
							className="ml-auto text-xs text-slate-400 underline decoration-slate-600 underline-offset-4 hover:text-white"
							type="button"
							onClick={() => setLines([])}
						>
							Clear this tab
						</button>
					) : null}
				</header>

				{lines.length === 0 ? (
					<div className="px-5 py-16 text-center font-mono">
						<p className="text-sm text-slate-300">
							Waiting for a personal request…
						</p>
						<p className="mt-2 text-xs text-slate-500">
							This page starts empty; past activity is not replayed.
						</p>
					</div>
				) : (
					<ol
						aria-live="polite"
						className="max-h-[32rem] overflow-y-auto p-2 font-mono text-xs"
					>
						{lines.map((line) => (
							<ConsoleLine key={line.key} line={line} />
						))}
					</ol>
				)}
			</section>
		</AccountPageLayout>
	);
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
	const styles = {
		connecting: "border-amber-200 bg-amber-50 text-amber-900",
		disconnected: "border-rose-200 bg-rose-50 text-rose-900",
		live: "border-sky-200 bg-sky-50 text-sky-900",
	}[state];
	return (
		<span className={`rounded-full border px-3 py-1 font-medium ${styles}`}>
			<span aria-hidden="true">● </span>
			{state}
		</span>
	);
}

function ConsoleLine({ line }: { line: RenderedLine }) {
	return (
		<li className="grid gap-1 rounded-lg px-3 py-2 hover:bg-white/5 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
			<div className="text-slate-500">
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
						<span className="ml-2 break-all text-slate-500">
							{line.requestId}
						</span>
					) : null}
				</p>
				<p className="mt-1 break-words text-slate-400">
					{line.details.join(" · ")}
				</p>
			</div>
		</li>
	);
}

function toneClassName(tone: PersonalConsoleLine["tone"]): string {
	return {
		activity: "text-sky-300",
		error: "text-rose-300",
		muted: "text-slate-300",
		success: "text-emerald-300",
		warning: "text-amber-300",
	}[tone];
}

function formatUtcClock(value: string): string {
	return `${value.slice(11, 19)}Z`;
}

function defaultEventSourceFactory(url: string): PersonalConsoleEventSource {
	return new EventSource(url);
}
