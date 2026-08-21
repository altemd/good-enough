import { useCallback, useRef, useState } from "react";

export interface SubmissionController {
	readonly isSubmitting: boolean;
	readonly busyLabel: string | null;
	readonly busyText: (label: string) => string | null;
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
	const pendingRuns = useRef(0);

	const busyText = useCallback(
		(label: string) => (isSubmitting && busyLabel === label ? label : null),
		[isSubmitting, busyLabel],
	);

	const run = useCallback(
		(
			networkError: string,
			operation: () => Promise<void>,
			label: string | undefined,
		) => {
			pendingRuns.current += 1;
			setError(null);
			setIsSubmitting(true);
			setBusyLabel(label ?? null);
			return operation()
				.catch(() => setError(networkError))
				.finally(() => {
					pendingRuns.current -= 1;
					if (pendingRuns.current === 0) {
						setIsSubmitting(false);
						setBusyLabel(null);
					}
				});
		},
		[],
	);

	return { isSubmitting, busyLabel, busyText, error, setError, run };
}
