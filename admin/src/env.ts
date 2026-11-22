import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	LUMI_ADMIN_API_URL: {
		description: 'Base URL of the lumi-server admin listener (LUMI_ADMIN_ADDR), without /admin/v1.',
		schema: (value) => {
			const raw = value?.trim() || 'http://127.0.0.1:8081';
			const url = new URL(raw);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				throw new Error('LUMI_ADMIN_API_URL must be an http or https URL');
			}
			return url.href.replace(/\/+$/, '');
		}
	}
});
