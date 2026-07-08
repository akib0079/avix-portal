import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { APIError } from "better-auth/api";
import { prisma } from "@/lib/prisma";
import { sendPasswordLinkEmail } from "@/lib/email/auth-emails";
import { appUrl } from "@/lib/app-url";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
    resetPasswordTokenExpiresIn: 60 * 60 * 24,
    // Invite links and password resets share better-auth's reset flow.
    // A user who has never completed their invite has emailVerified=false,
    // so they get the welcome template; everyone else gets the reset one.
    sendResetPassword: async ({ user, token }) => {
      const url = `${appUrl()}/reset-password?token=${token}`;
      await sendPasswordLinkEmail({
        to: user.email,
        name: user.name,
        url,
        invited: !user.emailVerified,
      });
    },
    onPasswordReset: async ({ user }) => {
      // Completing an invite (or any reset) proves inbox ownership.
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
    },
  },
  socialProviders:
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // Invite-only portal: Google can sign in EXISTING users but must
            // never create accounts. Unknown emails are rejected.
            disableImplicitSignUp: true,
          },
        }
      : undefined,
  account: {
    accountLinking: {
      enabled: true,
      // Google verifies email ownership, so it may link to the existing
      // admin-created user with the same address.
      trustedProviders: ["google"],
    },
  },
  user: {
    modelName: "User",
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "CLIENT" },
      firstName: { type: "string", input: false, defaultValue: "" },
      lastName: { type: "string", input: false, defaultValue: "" },
      company: { type: "string", input: false, required: false },
      phone: { type: "string", input: false, required: false },
      status: { type: "string", input: false, defaultValue: "ACTIVE" },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { status: true },
          });
          if (!user || user.status === "INACTIVE") {
            throw new APIError("FORBIDDEN", {
              message: "This account has been deactivated.",
            });
          }
        },
      },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
      "/reset-password": { window: 300, max: 5 },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
export type SessionUser = Session["user"];
