import { useAuthActions } from "@convex-dev/auth/react";

export function SignIn() {
  const { signIn } = useAuthActions();
  return (
    <div className="center">
      <div className="card hero">
        <span className="brand-mark big" aria-hidden="true" />
        <h1>Gmail Attachments</h1>
        <p className="muted">
          Find the files buried in your inbox and download all of them, or just the ones you pick, as one ZIP.
        </p>
        <button className="btn primary" onClick={() => void signIn("google")}>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
