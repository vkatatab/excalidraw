import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";

export type Scene = Required<
  Pick<ExcalidrawInitialDataState, "elements" | "appState" | "files">
>;
export type Board = {
  id: string;
  title: string;
  version: number;
  created_at: string;
  updated_at: string;
};
export type BoardDocument = Board & { scene: Scene };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      body.message || "Não foi possível conectar ao servidor. Tente novamente.",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
