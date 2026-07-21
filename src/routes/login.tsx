import { createFileRoute } from "@tanstack/react-router";

import { LoginPage } from "#/features/accounts/access/ui/login-page";

export const Route = createFileRoute("/login")({ component: LoginPage });
