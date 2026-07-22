import { Link } from "@tanstack/react-router";
import {
	Activity,
	Clock3,
	Gauge,
	LockKeyhole,
	Play,
	Server,
	ShieldCheck,
	Timer,
} from "lucide-react";
import { useState } from "react";

import { Button, buttonVariants } from "#/components/ui/button";
import type { AccountEntryState } from "#/features/accounts/access/ui/access-page";
import type {
	AccountMutationResult,
	CurrentAccount,
} from "#/features/accounts/account-contract";
import { ApiCredentialOnboarding } from "#/features/client-onboarding/api-credential-onboarding";

import { DemoChat } from "./demo-chat";
import {
	PublicAuthControls,
	PublicRegistrationControl,
} from "./public-auth-controls";

interface DemoCredential {
	apiKey: string;
	createdAt: number;
	expiresAt: number;
}

interface PublicDemoPageProps {
	account: CurrentAccount | null;
	entryState: AccountEntryState;
	issueDemoToken: () => Promise<AccountMutationResult<DemoCredential>>;
}

export function PublicDemoPage({
	account,
	entryState,
	issueDemoToken,
}: PublicDemoPageProps) {
	const [credential, setCredential] = useState<DemoCredential | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isIssuing, setIsIssuing] = useState(false);
	const [models, setModels] = useState<string[]>([]);

	async function startDemo() {
		setError(null);
		setModels([]);
		setIsIssuing(true);
		try {
			const result = await issueDemoToken();
			if (!result.ok) {
				setError(messageForDemoFailure(result));
				return;
			}
			setCredential(result.value);
		} catch {
			setError("The demo could not be started. Try again later.");
		} finally {
			setIsIssuing(false);
		}
	}

	return (
		<main className="min-h-screen bg-[radial-gradient(circle_at_top_left,oklch(0.97_0_0),transparent_38%),linear-gradient(to_bottom,oklch(1_0_0),oklch(0.985_0_0))]">
			<header className="border-b border-border/70 bg-background/85 backdrop-blur">
				<nav className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4 sm:px-8">
					<Link className="flex items-center gap-2 font-semibold" to="/">
						<span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
							<Server className="size-4" />
						</span>
						Good Enough
					</Link>
					<div className="ml-auto flex items-center gap-2">
						<PublicAuthControls account={account} entryState={entryState} />
					</div>
				</nav>
			</header>

			<div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:py-20">
				<section className="lg:sticky lg:top-10">
					<div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-xs">
						<span className="size-2 rounded-full bg-emerald-500" />
						Local inference · OpenAI- and Anthropic-compatible APIs
					</div>
					<h1 className="max-w-2xl text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
						Are local models good enough?
					</h1>
					<p className="mt-5 max-w-lg text-lg text-muted-foreground">
						Try one for an hour on a 128 GB AMD Ryzen AI Max+ 395 (Strix Halo)
						host.
					</p>
					<Button
						className="mt-7"
						size="lg"
						type="button"
						disabled={isIssuing || credential !== null}
						onClick={startDemo}
					>
						<Play data-icon="inline-start" />
						{isIssuing
							? "Starting…"
							: credential
								? "Demo running"
								: "Start one-hour demo"}
					</Button>
					<section
						className="mt-7 max-w-lg rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 text-emerald-950 shadow-xs"
						aria-labelledby="privacy-title"
					>
						<div className="flex items-center gap-2">
							<ShieldCheck className="size-5 text-emerald-700" />
							<h2 id="privacy-title" className="font-semibold">
								Private by design
							</h2>
						</div>
						<p className="mt-3 text-sm leading-6">
							Good Enough never persists your prompts, responses, reasoning, or
							tool arguments.
						</p>
						<ul className="mt-3 grid gap-2 text-xs leading-5 text-emerald-900/80">
							<li>
								The demo key and conversation stay in this browser tab; refresh
								or dismissal clears them.
							</li>
							<li>
								Request telemetry is content-free, live-only, and never
								replayed.
							</li>
							<li>
								Accounts store only account, session, and API-key lifecycle
								records.
							</li>
						</ul>
					</section>
					{error ? (
						<p
							className="mt-5 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{error}
						</p>
					) : null}
				</section>

				{credential ? (
					<div className="overflow-hidden rounded-3xl border bg-card shadow-xl shadow-black/5">
						{models.length > 0 ? (
							<DemoChat apiKey={credential.apiKey} models={models} />
						) : null}
						<details
							className="border-t bg-muted/20 px-5 py-4 sm:px-7"
							open={models.length === 0}
						>
							<summary className="cursor-pointer text-sm font-medium">
								Temporary API credential and client setup
							</summary>
							<ApiCredentialOnboarding
								apiKey={credential.apiKey}
								onModelsDiscovered={setModels}
								onDismiss={() => {
									setCredential(null);
									setModels([]);
								}}
							/>
						</details>
					</div>
				) : (
					<DemoInvitation />
				)}
			</div>

			<RequestTelemetryPitch account={account} entryState={entryState} />
		</main>
	);
}

function DemoInvitation() {
	return (
		<aside className="rounded-3xl border bg-card p-6 text-card-foreground shadow-xl shadow-black/5 sm:p-8">
			<div className="flex items-start gap-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted">
					<Server className="size-5" />
				</span>
				<div>
					<h2 className="font-semibold">One click opens the chat</h2>
					<p className="mt-1 text-sm leading-6 text-muted-foreground">
						Choose an available model and watch its response stream in real
						time.
					</p>
				</div>
			</div>
			<div className="mt-7 grid gap-3 sm:grid-cols-3">
				<Feature icon={<Clock3 />} title="One hour" body="Absolute expiry." />
				<Feature
					icon={<LockKeyhole />}
					title="Tab only"
					body="Refresh clears it."
				/>
				<Feature
					icon={<Activity />}
					title="Real stream"
					body="No external provider."
				/>
			</div>
		</aside>
	);
}

function RequestTelemetryPitch({
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
						Private request telemetry
					</p>
					<h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
						See what each request is doing.
					</h2>
					<p className="mt-4 max-w-xl leading-7 text-muted-foreground">
						Create an account to generate separate personal API keys that expire
						seven days after creation and watch TTFT, duration, token counts,
						prompt and generation speed, cache reuse, and capacity state for
						your own requests. Demo keys expire after one hour and cannot be
						extended or converted. The content-free feed is live-only and starts
						empty after refresh.
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
								label="Create account"
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
		<section
			className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-slate-100 shadow-2xl"
			aria-label="Example request telemetry preview"
		>
			<header className="flex items-center border-b border-slate-800 px-4 py-3">
				<div className="flex gap-1.5" aria-hidden="true">
					<span className="size-2.5 rounded-full bg-rose-400" />
					<span className="size-2.5 rounded-full bg-amber-300" />
					<span className="size-2.5 rounded-full bg-emerald-400" />
				</div>
				<p className="ml-3 font-mono text-xs text-slate-400">
					example preview · synthetic events
				</p>
			</header>
			<ol className="space-y-1 p-3 font-mono text-xs">
				{lines.map((line, index) => (
					<li
						className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 rounded-xl px-3 py-3 hover:bg-white/5"
						key={line.title}
					>
						<span className="text-slate-600">12:04:0{index + 1}Z</span>
						<div>
							<p className="flex items-center gap-2 text-sky-300 [&_svg]:size-3.5">
								{line.icon}
								{line.title}
							</p>
							<p className="mt-1 text-slate-400">{line.detail}</p>
						</div>
					</li>
				))}
			</ol>
			<p className="border-t border-slate-800 px-4 py-3 font-mono text-[11px] text-slate-500">
				No prompt, response, reasoning, credential, or username is included.
			</p>
		</section>
	);
}

function Feature({
	icon,
	title,
	body,
}: {
	icon: React.ReactNode;
	title: string;
	body: string;
}) {
	return (
		<div className="rounded-2xl border bg-background/80 p-4 shadow-xs">
			<span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
			<p className="mt-3 text-sm font-medium">{title}</p>
			<p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p>
		</div>
	);
}

function messageForDemoFailure(
	result: Extract<AccountMutationResult<DemoCredential>, { ok: false }>,
) {
	const retry = result.retryAfterSeconds
		? ` Try again in about ${formatRetry(result.retryAfterSeconds)}.`
		: "";
	if (result.code === "rate_limited") {
		return `Too many demo starts were requested.${retry}`;
	}
	if (result.code === "capacity_reached") {
		return `All temporary demo credentials are currently allocated.${retry}`;
	}
	if (result.code === "setup_required") {
		return "The demo is not ready until the operator completes setup.";
	}
	if (result.code === "demo_disabled") {
		return "New public demos are temporarily disabled.";
	}
	return "The demo could not be started. Try again later.";
}

function formatRetry(seconds: number) {
	if (seconds < 60) return `${seconds} seconds`;
	const minutes = Math.ceil(seconds / 60);
	return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
