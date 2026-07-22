import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOST } from "./constants.mjs";
import { createFakeInferenceBackend } from "./fake-backend.mjs";

export function createRuntimeOrchestrator() {
	const runtimeDirectory = mkdtempSync(join(tmpdir(), "good-enough-runtime-"));
	const databasePath = join(runtimeDirectory, "accounts.sqlite");
	const fakeBackend = createFakeInferenceBackend();
	let application;
	let applicationOrigin;
	let applicationStdout = "";
	let applicationStderr = "";
	let shuttingDown = false;

	return {
		async start() {
			await listen(fakeBackend.server);
			const mockPort = getServerPort(fakeBackend.server);
			const applicationPort = await reservePort();
			applicationOrigin = `http://${HOST}:${applicationPort}`;

			application = spawn(process.execPath, [".output/server/index.mjs"], {
				cwd: process.cwd(),
				env: {
					...process.env,
					HOST,
					ACCOUNT_BOOTSTRAP_TOKEN:
						"runtime-bootstrap-token-that-is-at-least-32-bytes",
					APP_ORIGIN: applicationOrigin,
					GOOD_ENOUGH_DATABASE_PATH: databasePath,
					LLAMA_SERVER_URL: `http://${HOST}:${mockPort}`,
					PORT: String(applicationPort),
				},
				stdio: ["ignore", "pipe", "pipe"],
			});
			application.stdout.setEncoding("utf8");
			application.stderr.setEncoding("utf8");
			application.stdout.on("data", (chunk) => {
				applicationStdout += chunk;
			});
			application.stderr.on("data", (chunk) => {
				applicationStderr += chunk;
			});

			return {
				application,
				applicationOrigin,
				databasePath,
				mockState: fakeBackend.state,
				readApplicationStdout: () => applicationStdout,
				readApplicationStderr: () => applicationStderr,
			};
		},
		async stop() {
			if (shuttingDown) {
				return;
			}
			shuttingDown = true;

			if (application && application.exitCode === null) {
				application.kill("SIGTERM");
				await Promise.race([once(application, "exit"), delay(2_000)]);
				if (application.exitCode === null) {
					application.kill("SIGKILL");
					await once(application, "exit");
				}
			}
			rmSync(runtimeDirectory, { recursive: true, force: true });

			if (fakeBackend.server.listening) {
				await new Promise((resolve, reject) => {
					fakeBackend.server.close((error) =>
						error ? reject(error) : resolve(),
					);
				});
			}
		},
		readApplicationStdout: () => applicationStdout,
		readApplicationStderr: () => applicationStderr,
	};
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getServerPort(server) {
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Expected a TCP server address");
	}
	return address.port;
}

function listen(server, port = 0) {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, HOST, () => {
			server.off("error", reject);
			resolve();
		});
	});
}

async function reservePort() {
	const server = createServer();
	await listen(server);
	const port = getServerPort(server);
	await new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
	return port;
}
