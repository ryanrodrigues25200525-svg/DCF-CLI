export async function fetchWithTimeout<T = Response>(
  fetcher: typeof fetch,
  input: string | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  requestName: string,
  consumeResponse?: (response: Response) => Promise<T> | T,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Request timeout must be a positive number of milliseconds.');
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`${requestName} timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(input, {...init, signal: controller.signal});
        return consumeResponse ? await consumeResponse(response) : response as unknown as T;
      })(),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
