import { createApiClient, createAuth } from "@baseworks/api-client";
import { env } from "./env";

export const api = createApiClient(env.VITE_API_URL);
export const auth = createAuth(env.VITE_API_URL);
