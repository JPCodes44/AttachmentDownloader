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
    a: "The app asks Google for read-only access. It can list emails and download attachments, but it can't send, change or delete anything. Attachment files go straight from Gmail to your browser and are never stored on our servers.",
  },
  {
    q: "Can I pick only certain file types, like PDFs or photos?",
    a: "Yes. Filter by file type, sender, subject, label and date range, or type any Gmail search query. Then download every match or just the files you tick.",
  },
  {
    q: "How do I stop the app from reading my Gmail?",
    a: "Click \"Disconnect Gmail\" in the app. That revokes the app's access with Google and deletes the stored key. You can also remove it any time from your Google Account's third-party connections page.",
  },
];
