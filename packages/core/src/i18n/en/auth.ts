import type { Messages } from "../types.ts";
import type { auth as source } from "../zh/auth.ts";

export const auth: Messages<typeof source> = {
  auth: {
    loginTitle: "Continue your story",
    registerTitle: "Create an account",
    tagline: "Import a character card and write the story in the first person.",
    taglineLines: "Import a character card,\nwrite the story in the first person.",
    email: "Email",
    password: "Password",
    passwordPlaceholder: "Enter your password",
    passwordMin: "At least {{min}} characters",
    passwordTyped: "{{length}} characters typed, at least {{min}}",
    passwordLength_one: "{{count}} character",
    passwordLength_other: "{{count}} characters",
    showPassword: "Show password",
    hidePassword: "Hide password",
    nickname: "Nickname",
    login: "Sign in",
    register: "Sign up",
    registerAndLogin: "Sign up and sign in",
    noAccount: "No account yet?",
    backToLogin: "Back to sign in",
    cantConnect: "Can't reach the server. Check the address or your network.",
  },
};
