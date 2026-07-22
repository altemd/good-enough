import { Link } from "@tanstack/react-router";
import {
	Activity,
	Gauge,
	KeyRound,
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

			<div
				className={
					credential
						? "mx-auto grid max-w-[90rem] gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.75fr)] lg:items-start"
						: "mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:py-20"
				}
			>
				{credential ? null : (
					<section className="lg:sticky lg:top-10">
						<div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-xs">
							<span className="size-2 rounded-full bg-emerald-500" />
							Personal project · Local inference
						</div>
						<h1 className="max-w-2xl text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
							Are local models good enough?
						</h1>
						<p className="mt-5 max-w-lg text-lg leading-8 text-muted-foreground">
							Good Enough is a personal project built to find out. It runs local
							models on a 128 GB AMD Ryzen AI Max+ 395 (Strix Halo) and exposes
							them through OpenAI- and Anthropic-compatible APIs.
						</p>
						<p className="mt-4 max-w-lg leading-7 text-muted-foreground">
							The button generates a free temporary API key that works for one
							hour. You can use it in the chat here or copy it into your own
							client. No account or payment is required.
						</p>
						<Button
							className="mt-7"
							size="lg"
							type="button"
							disabled={isIssuing || credential !== null}
							onClick={startDemo}
						>
							<KeyRound data-icon="inline-start" />
							{isIssuing
								? "Generating API key…"
								: credential
									? "API key ready"
									: "Get a free one-hour API key"}
						</Button>
						{error ? (
							<p
								className="mt-5 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
								role="alert"
							>
								{error}
							</p>
						) : null}
					</section>
				)}

				{credential ? (
					<>
						<section className="order-2 min-w-0 overflow-hidden rounded-3xl border bg-card shadow-xl shadow-black/5 lg:order-1">
							{models.length > 0 ? (
								<DemoChat apiKey={credential.apiKey} models={models} />
							) : (
								<div
									className="flex min-h-[32rem] items-center justify-center bg-muted/20 p-8 text-center"
									aria-live="polite"
								>
									<div>
										<h2 className="font-semibold">Preparing the chat</h2>
										<p className="mt-2 text-sm text-muted-foreground">
											Checking which local models are available…
										</p>
									</div>
								</div>
							)}
						</section>
						<aside
							className="order-1 min-w-0 lg:order-2 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain"
							aria-label="Temporary API key and client setup"
						>
							<ApiCredentialOnboarding
								apiKey={credential.apiKey}
								onModelsDiscovered={setModels}
								onDismiss={() => {
									setCredential(null);
									setModels([]);
								}}
							/>
						</aside>
					</>
				) : (
					<div className="grid gap-6">
						<DemoInvitation />
						<PrivacySummary />
					</div>
				)}
			</div>

			{credential ? null : (
				<RequestTelemetryPitch account={account} entryState={entryState} />
			)}
		</main>
	);
}

function DemoInvitation() {
	return (
		<aside className="rounded-3xl border bg-card p-6 text-card-foreground shadow-xl shadow-black/5 sm:p-8">
			<div className="flex items-start gap-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted">
					<KeyRound className="size-5" />
				</span>
				<div>
					<h2 className="font-semibold">What the button does</h2>
					<p className="mt-2 text-sm leading-6 text-muted-foreground">
						It creates an API key and shows it once in this browser tab. The key
						can call the OpenAI- and Anthropic-compatible endpoints, and the
						built-in chat uses the same API.
					</p>
				</div>
			</div>
			<p className="mt-7 rounded-2xl bg-muted/60 p-4 text-sm leading-6 text-muted-foreground">
				The key is free, requires no account, and expires one hour after it is
				created. Requests go to llama.cpp on this machine rather than to OpenAI
				or Anthropic; compatibility refers to the API format.
			</p>
		</aside>
	);
}

function PrivacySummary() {
	return (
		<section
			className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 text-emerald-950 shadow-xs"
			aria-labelledby="privacy-title"
		>
			<div className="flex items-center gap-2">
				<ShieldCheck className="size-5 text-emerald-700" />
				<h2 id="privacy-title" className="font-semibold">
					What gets stored?
				</h2>
			</div>
			<p className="mt-3 text-sm leading-6">
				Good Enough does not persist inference content: your prompts, responses,
				reasoning, and tool arguments are not saved.
			</p>
			<ul className="mt-3 grid gap-2 text-xs leading-5 text-emerald-900/80">
				<li>
					The temporary key and chat history exist only in this browser tab;
					refreshing the page or dismissing the key clears them.
				</li>
				<li>
					Live request timing does not contain inference content and is not
					saved or replayed.
				</li>
				<li>
					If you create an account, the server stores only the records needed
					for the account, session, and API keys.
				</li>
				<li>
					Anonymous hourly counts of rendered landing views, demo keys, and demo
					request outcomes are retained as aggregate metrics. They contain no
					identifiers or inference content.
				</li>
			</ul>
		</section>
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
