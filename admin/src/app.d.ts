import type { PanelSession } from '#lib/server/sessions.ts';

declare global {
	namespace App {
		interface Locals {
			session: PanelSession | null;
		}
		interface Error {
			message: string;
		}
	}
}

export {};
