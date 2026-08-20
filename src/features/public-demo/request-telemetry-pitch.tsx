import { Link } from "@tanstack/react-router";
import { Activity, Gauge, Timer } from "lucide-react";

import { buttonVariants } from "#/components/ui/button";
import { ConsoleFrame } from "#/components/ui/console-frame";
import type { AccountEntryState } from "#/features/accounts/access/account-access.functions";
import type { CurrentAccount } from "#/features/accounts/account-contract";

import { PublicRegistrationControl } from "./public-auth-controls";

export function RequestTelemetryPitch({
	account,
	entryState,
}: {
	account: CurrentAccount | null;
	entryState: AccountEntryState;
}) {
	return (
		<section className="border-t bg-background/75">
			<div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:py-24">
				<div>
					<p className="text-sm font-medium text-muted-foreground">
						Optional account
					</p>
					<h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
						Seven-day API keys and live request timing
					</h2>
					<p className="mt-4 max-w-xl leading-7 text-muted-foreground">
						A free account lets you create personal API keys that last seven
						days. It also includes a live view of request timing—TTFT, duration,
						token counts, processing and generation speed, cache reuse, and
						capacity. The console does not include inference content and starts
						empty whenever the page is refreshed. There is no paid tier.
					</p>
					<div className="mt-6">
						{account ? (
							<Link
								className={buttonVariants({ variant: "outline", size: "lg" })}
								to="/account/live-console"
							>
								Open live console
							</Link>
						) : (
							<PublicRegistrationControl
								state={entryState}
								label="Create a free account"
							/>
						)}
					</div>
				</div>
				<TelemetryPreview />
			</div>
		</section>
	);
}

function TelemetryPreview() {
	const lines = [
		{
			icon: <Activity />,
			title: "request accepted",
			detail: "chat · admitted",
		},
		{ icon: <Timer />, title: "first output", detail: "TTFT 438 ms" },
		{
			icon: <Gauge />,
			title: "request complete",
			detail: "1.8 s · 42 tokens · 38.6 tok/s · cache reused",
		},
	];
	return (
		<ConsoleFrame
			title="example preview · synthetic events"
			className="shadow-2xl"
		>
			<ol className="space-y-1 p-3 font-mono text-xs">
				{lines.map((line, index) => (
					<li
						className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 rounded-xl px-3 py-3 hover:bg-terminal-hover"
						key={line.title}
					>
						<span className="text-terminal-faint">12:04:0{index + 1}Z</span>
						<div>
							<p className="flex items-center gap-2 text-terminal-info [&_svg]:size-3.5">
								{line.icon}
								{line.title}
							</p>
							<p className="mt-1 text-terminal-muted">{line.detail}</p>
						</div>
					</li>
				))}
			</ol>
			<p className="border-t border-terminal-border px-4 py-3 font-mono text-[11px] text-terminal-faint">
				No prompt, response, reasoning, credential, or username is included.
			</p>
		</ConsoleFrame>
	);
}
