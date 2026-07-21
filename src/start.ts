import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

import { parseApplicationOrigin } from "#/features/accounts/app-origin";

export const startInstance = createStart(() => ({
	requestMiddleware: [
		createCsrfMiddleware({
			filter: (context) => context.handlerType === "serverFn",
			origin: (origin) => origin === readConfiguredOrigin(),
		}),
	],
}));

function readConfiguredOrigin() {
	return parseApplicationOrigin(process.env.APP_ORIGIN, process.env.NODE_ENV)
		.origin;
}
