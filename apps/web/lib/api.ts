import { createApiClient, createAuth } from "@baseworks/api-client";
import { env } from "./env";

export const api = createApiClient(env.NEXT_PUBLIC_API_URL);
export const auth = createAuth(env.NEXT_PUBLIC_API_URL);
