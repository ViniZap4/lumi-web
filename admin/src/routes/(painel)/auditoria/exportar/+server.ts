import { error } from '@sveltejs/kit';
import { AdminError, adminErrorMessage } from '#lib/admin.ts';
import { CSV_HEADER, csvCell, csvRow, filtersOf } from '#lib/audit.ts';
import { addressOf, clientFor, signOut } from '#lib/server/api.ts';
import { resolveFilters } from '#lib/server/audit.ts';
import type { RequestHandler } from './$types';

/** The API pages 100 at a time; 100 pages is plenty for an operator's spreadsheet and bounds the work per click. */
const MAX_PAGES = 100;

/**
 * The audit log with the page's filters, as CSV. A GET that changes nothing, behind the panel session like every
 * page; the rows are streamed as the API pages arrive. Cells are quoted and guarded against formula injection.
 */
export const GET: RequestHandler = async (event) => {
	const session = event.locals.session;
	if (!session) error(401, 'Sessão encerrada.');
	const api = clientFor(session.token, addressOf(event));
	const f = filtersOf(event.url);
	if (f.invalid.length > 0) error(400, 'Filtro inválido.');
	let resolved;
	let first;
	try {
		resolved = await resolveFilters(api, f);
		if (resolved.unknown.length > 0) error(404, 'Usuário ou cofre do filtro não encontrado.');
		first = await api.audit({ ...resolved.query, limit: 100 });
	} catch (e) {
		if (!(e instanceof AdminError)) throw e;
		if (e.kind === 'unauthorized') signOut(event, session);
		error(e.kind === 'offline' ? 503 : 502, adminErrorMessage(e));
	}
	const query = resolved.query;
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			// BOM so spreadsheet apps read UTF-8 (accents in labels and names).
			controller.enqueue(encoder.encode('﻿' + CSV_HEADER.map(csvCell).join(',') + '\r\n'));
			let page = first;
			for (let n = 1; ; n++) {
				const chunk = page.entries.map((e) => csvRow(e) + '\r\n').join('');
				if (chunk) controller.enqueue(encoder.encode(chunk));
				if (!page.more || !page.next || n >= MAX_PAGES) break;
				try {
					page = await api.audit({ ...query, before: Number(page.next), limit: 100 });
				} catch {
					controller.enqueue(encoder.encode(csvCell('# exportação interrompida: a API parou de responder') + '\r\n'));
					break;
				}
			}
			controller.close();
		}
	});
	const stamp = new Date().toISOString().slice(0, 10);
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="lumi-auditoria-${stamp}.csv"`,
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
