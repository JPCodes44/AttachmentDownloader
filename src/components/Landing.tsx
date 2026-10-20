import { FAQ } from "../lib/faq";

// The signed-out page. It takes no Convex hooks so scripts/prerender.ts can
// render it into dist/index.html for search engines and first paint.
export function Landing({ onSignIn }: { onSignIn?: () => void }) {
  return (
    <div className="landing">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          AttachmentDownloader
        </a>
        <a className="small" href="/gmail-attachments-not-downloading">
          Can't download an attachment?
        </a>
      </header>

      <main>
        <section className="landing-hero">
          <h1>Download all your Gmail attachments at once</h1>
          <p className="lead muted">
            Find the files buried in your inbox and download all of them, or just the ones you pick, as one ZIP.
            Filter by sender, date, label or file type.
          </p>
          <button className="btn primary big" onClick={onSignIn}>
            Sign in with Google
          </button>
          <p className="muted small">
            Google will ask for <b>read-only</b> Gmail access. The app can list emails and download attachments, but it
            can't send, change or delete anything.
          </p>
        </section>

        <section className="landing-section">
          <h2>How it works</h2>
          <ol className="steps">
            <li>
              <b>Sign in with Google.</b> One consent screen, read-only access.
            </li>
            <li>
              <b>Search your inbox.</b> Pick a sender, date range, label or file type, or type any Gmail search.
            </li>
            <li>
              <b>Pick the files.</b> Every attachment that matches is listed with its sender, subject and size.
            </li>
            <li>
              <b>Download one ZIP.</b> Files go straight from Gmail to your browser, never through our servers.
            </li>
          </ol>
        </section>

        <section className="landing-section">
          <h2>Can't download attachments in Gmail?</h2>
          <p className="muted">
            If Gmail's download button does nothing, shows a virus warning or fails partway, the cause is usually a
            blocked file type, a browser setting or an admin policy.{" "}
            <a href="/gmail-attachments-not-downloading">Read the step-by-step fixes</a>.
          </p>
        </section>

        <section className="landing-section">
          <h2>Questions</h2>
          <div className="faq">
            {FAQ.map(({ q, a }) => (
              <details key={q}>
                <summary>{q}</summary>
                <p className="muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="landing-footer muted small">
        <a href="/download-all-gmail-attachments">Download all Gmail attachments</a>
        <a href="/download-gmail-attachments-from-sender">Attachments from one sender</a>
        <a href="/gmail-attachments-not-downloading">Fix Gmail attachment downloads</a>
        <a href="/privacy">Privacy</a>
      </footer>
    </div>
  );
}
