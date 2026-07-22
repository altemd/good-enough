import { ClientOnly, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Check,
	Clock3,
	Copy,
	KeyRound,
	LockKeyhole,
	Play,
	Server,
} from "lucide-react";
import { useState } from "react";

import { Button, buttonVariants } from "#/components/ui/button";
import type {
	AccountMutationResult,
	CurrentAccount,
} from "#/features/accounts/account-contract";

import { DemoChat } from "./demo-chat";

interface DemoCredential {
	apiKey: string;
	createdAt: number;
	expiresAt: number;
}

interface PublicDemoPageProps {
	account: CurrentAccount | null;
	issueDemoToken: () => Promise<AccountMutationResult<DemoCredential>>;
}

export function PublicDemoPage({
	account,
	issueDemoToken,
}: PublicDemoPageProps) {
	const [credential, setCredential] = useState<DemoCredential | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isIssuing, setIsIssuing] = useState(false);
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
		"idle",
	);

	async function startDemo() {
		setError(null);
		setCopyState("idle");
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

	async function copyCredential() {
		if (!credential) return;
		try {
			await navigator.clipboard.writeText(credential.apiKey);
			setCopyState("copied");
		} catch {
			setCopyState("failed");
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
						{account ? (
							<Link
								className={buttonVariants({ variant: "outline" })}
								to="/account"
							>
								Open account
								<ArrowRight data-icon="inline-end" />
							</Link>
						) : (
							<>
								<Link
									className={buttonVariants({ variant: "ghost" })}
									to="/login"
								>
									Sign in
								</Link>
								<Link
									className={buttonVariants({ variant: "outline" })}
									to="/register"
								>
									Create account
								</Link>
							</>
						)}
					</div>
				</nav>
			</header>

			<div className="mx-auto grid max-w-6xl gap-12 px-5 py-14 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-24">
				<section>
					<div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-xs">
						<span className="size-2 rounded-full bg-emerald-500" />
						Local inference, open compatibility APIs
					</div>
					<h1 className="max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
						Try the real API before creating an account.
					</h1>
					<p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
						Start an explicit one-hour demo with a temporary credential. It uses
						the same OpenAI- and Anthropic-compatible gateway as registered
						clients, without saving inference content or linking activity to an
						account.
					</p>

					<div className="mt-8 flex flex-wrap items-center gap-3">
						<Button
							size="lg"
							type="button"
							disabled={isIssuing || credential !== null}
							onClick={startDemo}
						>
							<Play data-icon="inline-start" />
							{isIssuing
								? "Starting demo…"
								: credential
									? "Demo started"
									: "Start one-hour demo"}
						</Button>
						<span className="text-sm text-muted-foreground">
							Nothing is issued until you click.
						</span>
					</div>

					<div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
						<Feature
							icon={<Clock3 />}
							title="One-hour access"
							body="Absolute expiry; no silent renewal."
						/>
						<Feature
							icon={<LockKeyhole />}
							title="Memory only"
							body="Refresh or dismiss to forget the token."
						/>
						<Feature
							icon={<Server />}
							title="Real local model"
							body="No external inference provider."
						/>
					</div>
				</section>

				<aside className="rounded-3xl border bg-card p-5 text-card-foreground shadow-xl shadow-black/5 sm:p-7">
					<div className="flex items-start gap-3">
						<span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted">
							<KeyRound className="size-5" />
						</span>
						<div>
							<h2 className="font-semibold">Temporary API credential</h2>
							<p className="mt-1 text-sm leading-6 text-muted-foreground">
								The complete value appears once and remains only in this page’s
								memory.
							</p>
						</div>
					</div>

					{credential ? (
						<div className="mt-6" aria-live="polite">
							<div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
								<p className="text-sm font-semibold">Copy this token now</p>
								<p className="mt-1 text-xs leading-5 text-amber-900/80">
									It cannot be recovered after you dismiss it or leave this
									page.
								</p>
								<code className="mt-3 block max-h-28 overflow-auto rounded-xl bg-white/80 p-3 text-xs break-all select-all">
									{credential.apiKey}
								</code>
								<div className="mt-3 flex flex-wrap items-center gap-2">
									<Button size="sm" type="button" onClick={copyCredential}>
										{copyState === "copied" ? <Check /> : <Copy />}
										{copyState === "copied" ? "Copied" : "Copy token"}
									</Button>
									<Button
										size="sm"
										variant="ghost"
										type="button"
										onClick={() => {
											setCredential(null);
											setCopyState("idle");
										}}
									>
										Dismiss
									</Button>
								</div>
								{copyState === "failed" ? (
									<output className="mt-2 block text-xs">
										Copy failed. Select the token and copy it manually.
									</output>
								) : null}
							</div>
							<p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
								<Clock3 className="size-4" />
								Expires <DemoExpiry value={credential.expiresAt} />
							</p>
						</div>
					) : (
						<div className="mt-6 rounded-2xl border border-dashed bg-muted/40 p-6 text-center">
							<KeyRound className="mx-auto size-7 text-muted-foreground" />
							<p className="mt-3 text-sm font-medium">No demo token issued</p>
							<p className="mt-1 text-xs leading-5 text-muted-foreground">
								Starting the demo creates one independently expiring token. It
								does not send a prompt or acquire inference capacity.
							</p>
						</div>
					)}

					{error ? (
						<p
							className="mt-4 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{error}
						</p>
					) : null}
				</aside>
			</div>
			{credential ? <DemoChat apiKey={credential.apiKey} /> : null}
		</main>
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

function DemoExpiry({ value }: { value: number }) {
	const instant = new Date(value);
	const isoDate = instant.toISOString();
	return (
		<ClientOnly fallback={<time dateTime={isoDate}>{formatUtc(isoDate)}</time>}>
			<time dateTime={isoDate}>
				{new Intl.DateTimeFormat(undefined, {
					dateStyle: "medium",
					timeStyle: "short",
				}).format(instant)}
			</time>
		</ClientOnly>
	);
}

function formatUtc(isoDate: string) {
	return `${isoDate.slice(0, 10)} ${isoDate.slice(11, 16)} UTC`;
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
