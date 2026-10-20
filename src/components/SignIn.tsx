import { useAuthActions } from "@convex-dev/auth/react";
import { Landing } from "./Landing";

export function SignIn() {
  const { signIn } = useAuthActions();
  return <Landing onSignIn={() => void signIn("google")} />;
}
