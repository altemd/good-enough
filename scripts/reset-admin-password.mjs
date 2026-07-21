import { resetAdministratorPasswordFromHost } from "../src/features/accounts/administrator-recovery.server.ts";

const username = process.argv[2];
if (!username || process.argv.length !== 3) {
	console.error("Usage: pnpm account:reset-admin -- <username>");
	process.exitCode = 1;
} else {
	try {
		const result = await resetAdministratorPasswordFromHost(username);
		if (!result) {
			console.error("Administrator account not found.");
			process.exitCode = 1;
		} else {
			console.info("Temporary administrator password (shown once):");
			console.info(result.temporaryPassword);
			console.info(`Expires at: ${new Date(result.expiresAt).toISOString()}`);
		}
	} catch {
		console.error("Administrator password reset failed.");
		process.exitCode = 1;
	}
}
