import { FAQ } from "../lib/faq";

// The signed-out page. It takes no Convex hooks so scripts/prerender.ts can
// render it into dist/index.html for search engines and first paint.
export function Landing({ onSignIn }: { onSignIn?: () => void }) {
  return (
    <div className="landing">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          AttachmentDownloader
        </a>
        <nav className="topbar-actions small" aria-label="Main navigation">
          <a href="/guides">Download guides</a>
          <a href="/about">About &amp; support</a>
        </nav>
      </header>

      <main id="main-content">
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
            Google will ask for <b>read-only</b> Gmail access. Searches and downloads run in your browser; Gmail data
            and files are not sent to our backend.
          </p>
          <p className="small muted">Free to use · No extension to install · Download original files</p>
        </section>

        <section className="landing-section">
          <h2>Find the files you need</h2>
          <div className="guide-grid">
            <a className="guide-card" href="/download-pdf-attachments-gmail">
              <h3>PDFs, invoices and receipts</h3>
              <p>Filter individual attachments to PDF files, then narrow by sender or subject.</p>
            </a>
            <a className="guide-card" href="/download-gmail-attachments-from-sender">
              <h3>Files from one sender</h3>
              <p>Collect the attachments a person or supplier sent across many emails.</p>
            </a>
            <a className="guide-card" href="/download-gmail-attachments-by-date">
              <h3>A month, year or custom period</h3>
              <p>Choose a date window and split large searches into manageable batches.</p>
            </a>
          </div>
        </section>

        <section className="landing-section">
          <h2>What to know before downloading</h2>
          <p className="muted">
            One search stops at 25,000 emails or 10,000 attachments. For a large mailbox, narrow the sender or date
            range and download in batches. Keep the page open until the download finishes. Google Drive links
            are separate from email attachments.
          </p>
          <p className="muted">
            For a complete mailbox archive, compare <a href="/download-all-gmail-attachments">Google Takeout and
            other download methods</a>. Learn <a href="/about">how this app works</a> and read the <a href="/privacy">privacy policy</a>.
          </p>
        </section>

        <section className="landing-section">
          <h2>How it works</h2>
          <ol className="steps">
            <li>
              <b>Sign in, then connect Gmail.</b> Account sign-in and Gmail permission are separate.
            </li>
            <li>
              <b>Search your inbox.</b> Pick a sender, date range, label or file type, or type any Gmail search.
            </li>
            <li>
              <b>Pick the files.</b> Every attachment that matches is listed with its sender, subject and size.
            </li>
            <li>
              <b>Download one ZIP.</b> Gmail data and files go straight to your browser, where the ZIP is built.
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
        <a href="/guides">All download guides</a>
        <a href="/about">About &amp; support</a>
        <a href="/privacy">Privacy</a>
      </footer>
    </div>
  );
}
