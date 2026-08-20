import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { useSubmission } from "#/components/common/use-submission";
import type { AccountEntryState } from "#/features/accounts/access/account-access.functions";
import type {
	AccountMutationResult,
	CurrentAccount,
} from "#/features/accounts/account-contract";
import { ApiCredentialOnboarding } from "#/features/client-onboarding/api-credential-onboarding";

import { DemoChat } from "./demo-chat";
import { type DemoCredential, messageForDemoFailure } from "./demo-credential";
import { DemoInvitation } from "./demo-invitation";
import { LandingHero } from "./landing-hero";
import { PrivacySummary } from "./privacy-summary";
import { PublicAuthControls } from "./public-auth-controls";
import { RequestTelemetryPitch } from "./request-telemetry-pitch";

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
	const { isSubmitting, error, setError, run } = useSubmission();
	const [models, setModels] = useState<string[]>([]);

	function startDemo() {
		setModels([]);
		void run("The demo could not be started. Try again later.", async () => {
			const result = await issueDemoToken();
			if (!result.ok) {
				setError(messageForDemoFailure(result));
				return;
			}
			setCredential(result.value);
		});
	}

	return (
		<main className="min-h-screen bg-[radial-gradient(circle_at_top_left,oklch(0.97_0_0),transparent_38%),linear-gradient(to_bottom,oklch(1_0_0),oklch(0.985_0_0))]">
			<header className="border-b border-border/70 bg-background/85 backdrop-blur">
				<nav className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4 sm:px-8">
					<Link className="flex items-center gap-2 font-semibold" to="/">
						<span
							aria-hidden="true"
							className="flex size-8 items-center justify-center rounded-xl bg-primary text-[0.7rem] font-bold tracking-[-0.08em] text-primary-foreground"
						>
							GE
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
					<LandingHero
						isSubmitting={isSubmitting}
						error={error}
						onStartDemo={startDemo}
					/>
				)}

				{credential ? (
					<>
						<h1 className="sr-only">Live demo</h1>
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
							className="order-1 min-w-0 lg:order-2 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto"
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
