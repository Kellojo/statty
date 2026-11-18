/** A JSON request to Statty's own API; throws with the server's message on failure. */
export async function apiRequest<T = unknown>(
	path: string,
	method = 'GET',
	body?: unknown
): Promise<T> {
	const res = await fetch(path, {
		method,
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const payload = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
	if (!res.ok) throw new Error(payload?.message ?? `Request failed (${res.status})`);
	return payload as T;
}
