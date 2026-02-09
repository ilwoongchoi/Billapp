import { getServiceSupabaseClient } from "@/lib/supabase";

export interface ApiUser {
  id: string;
  email: string | null;
  accessToken: string;
}

export class ApiAuthError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function readBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim();
}

export async function getApiUser(request: Request): Promise<ApiUser | null> {
  const accessToken = readBearerToken(request);
  if (!accessToken) {
    return null;
  }

  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    return null;
  }

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    accessToken,
  };
}

export async function requireApiUser(request: Request): Promise<ApiUser> {
  const user = await getApiUser(request);
  if (!user) {
    throw new ApiAuthError(
      401,
      "unauthorized",
      "Missing or invalid bearer token. Sign in and pass Authorization: Bearer <access_token>.",
    );
  }

  return user;
}

