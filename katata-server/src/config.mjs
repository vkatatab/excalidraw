export function readConfig(env = process.env) {
  const origin = new URL(env.APP_URL || "http://localhost:3000");
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }
  if (env.NODE_ENV === "production" && origin.protocol !== "https:") {
    throw new Error("APP_URL must use HTTPS in production");
  }
  return {
    origin: origin.origin,
    databaseUrl: env.DATABASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    port: Number(env.PORT || 3001),
    production: env.NODE_ENV === "production",
  };
}
