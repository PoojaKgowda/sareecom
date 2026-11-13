export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new ApiError(
      `The API returned a non-JSON response (HTTP ${response.status}). Check that the deployed /api route points to the API function.`,
      response.status,
    );
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error
      : "The request could not be completed.";
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
