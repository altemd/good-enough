import { useCallback, useState } from "react";

export interface SubmissionController {
	readonly isSubmitting: boolean;
	readonly busyLabel: string | null;
	readonly error: string | null;
	setError(message: string | null): void;
	run(
		networkError: string,
		operation: () => Promise<void>,
		busyLabel?: string,
	): Promise<void>;
}

export function useSubmission(): SubmissionController {
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [busyLabel, setBusyLabel] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const run = useCallback(
		(
			networkError: string,
			operation: () => Promise<void>,
			label: string | undefined,
		) => {
			setError(null);
			setIsSubmitting(true);
			setBusyLabel(label ?? null);
			return operation()
				.catch(() => setError(networkError))
				.finally(() => {
					setIsSubmitting(false);
					setBusyLabel(null);
				});
		},
		[],
	);

	return { isSubmitting, busyLabel, error, setError, run };
}
