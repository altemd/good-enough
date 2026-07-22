import { Link } from "@tanstack/react-router";
import { ArrowRight, X } from "lucide-react";
import { useId } from "react";

import { buttonVariants } from "#/components/ui/button";
import type { AccountEntryState } from "#/features/accounts/access/ui/access-page";
import { LoginForm } from "#/features/accounts/access/ui/login-form";
import { RegistrationForm } from "#/features/accounts/access/ui/registration-form";
import type { CurrentAccount } from "#/features/accounts/account-contract";

export function PublicAuthControls({
	account,
	entryState,
}: {
	account: CurrentAccount | null;
	entryState: AccountEntryState;
}) {
	if (account) {
		return (
			<Link className={buttonVariants({ variant: "outline" })} to="/account">
				Open account
				<ArrowRight data-icon="inline-end" />
			</Link>
		);
	}

	return (
		<>
			<AuthPopover label="Sign in" title="Sign in to Good Enough">
				<LoginForm />
			</AuthPopover>
			<PublicRegistrationControl state={entryState} />
		</>
	);
}

export function PublicRegistrationControl({
	state,
	label = "Create account",
}: {
	state: AccountEntryState;
	label?: string;
}) {
	return (
		<AuthPopover label={label} title="Create a member account" outline>
			<RegistrationForm state={state} />
		</AuthPopover>
	);
}

function AuthPopover({
	label,
	title,
	outline = false,
	children,
}: {
	label: string;
	title: string;
	outline?: boolean;
	children: React.ReactNode;
}) {
	const popoverId = useId();
	const titleId = `${popoverId}-title`;

	return (
		<>
			<button
				type="button"
				className={buttonVariants({ variant: outline ? "outline" : "ghost" })}
				popoverTarget={popoverId}
				aria-haspopup="dialog"
			>
				{label}
			</button>
			<div
				id={popoverId}
				popover="auto"
				role="dialog"
				aria-labelledby={titleId}
				className="fixed inset-auto top-16 right-4 m-0 w-[min(23rem,calc(100vw-2rem))] rounded-2xl border bg-popover p-5 text-popover-foreground shadow-xl outline-none sm:right-8"
			>
				<div className="mb-4 flex items-center gap-3">
					<h2 id={titleId} className="text-lg font-semibold">
						{title}
					</h2>
					<button
						type="button"
						className="ml-auto flex size-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
						aria-label={`Close ${label.toLowerCase()}`}
						popoverTarget={popoverId}
						popoverTargetAction="hide"
					>
						<X className="size-4" />
					</button>
				</div>
				{children}
			</div>
		</>
	);
}
