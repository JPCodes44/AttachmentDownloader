// Shown on the landing page and emitted as FAQPage structured data by
// scripts/prerender.ts, so the visible answers and the markup never drift.
export const FAQ: { q: string; a: string }[] = [
  {
    q: "How do I download all attachments from Gmail at once?",
    a: "Gmail only offers \"Download all\" inside a single email. To get attachments from many emails, sign in here, search by sender, date, label or file type, tick the files you want (or all of them), and download them as one ZIP.",
  },
  {
    q: "Why can't I download an attachment in Gmail?",
    a: "The usual causes are a file Gmail blocks for security (like .exe or .js files), a browser extension or cookie setting interfering, a work or school account whose admin blocks downloads, or a large file that was sent as a Google Drive link. Our guide walks through each fix.",
  },
  {
    q: "Is it safe to give this app access to my Gmail?",
    a: "Google grants the browser read-only access so it can search messages and retrieve attachments. The app can't send, change or delete email. Gmail search results and attachment files stay in the browser and are not sent to our backend.",
  },
  {
    q: "Can I pick only certain file types, like PDFs or photos?",
    a: "Yes. Filter by file type, sender, subject, label and date range, or type any Gmail search query. Then download every match or just the files you tick.",
  },
  {
    q: "How do I stop the app from reading my Gmail?",
    a: "Click \"Disconnect Gmail\" in the app to revoke this browser's access and clear its in-memory token. You can also remove the app at any time from your Google Account's third-party connections page.",
  },
];
