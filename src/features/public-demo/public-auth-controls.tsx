import { Popover } from "@base-ui/react/popover";
import { Link } from "@tanstack/react-router";
import { ArrowRight, X } from "lucide-react";

import { buttonVariants } from "#/components/ui/button";
import type { AccountEntryState } from "#/features/accounts/access/account-access.functions";
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
	return (
		<Popover.Root modal="trap-focus">
			<Popover.Trigger
				className={buttonVariants({ variant: outline ? "outline" : "ghost" })}
			>
				{label}
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner align="end" sideOffset={8} className="z-50">
					<Popover.Popup className="w-[min(23rem,calc(100vw-2rem))] rounded-2xl border bg-popover p-5 text-popover-foreground shadow-xl outline-none">
						<div className="mb-4 flex items-center gap-3">
							<Popover.Title className="text-lg font-semibold">
								{title}
							</Popover.Title>
							<Popover.Close
								className="ml-auto flex size-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
								aria-label={`Close ${label.toLowerCase()}`}
							>
								<X className="size-4" />
							</Popover.Close>
						</div>
						{children}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
