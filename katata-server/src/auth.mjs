import { betterAuth } from "better-auth";

export function createAuth(pool, config) {
  return betterAuth({
    appName: "Katata Draw",
    baseURL: config.origin,
    secret: config.secret,
    telemetry: { enabled: false },
    database: pool,
    trustedOrigins: [config.origin],
    disabledPaths: ["/sign-up/email"],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    advanced: {
      useSecureCookies: config.production,
      // The application runs behind the Coolify proxy in production.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
  });
}
