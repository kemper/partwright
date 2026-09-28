---
date: 2026-09-28
branch: claude/vibrant-volta-1g2epu
files_changed:
  - .github/ISSUE_TEMPLATE/bug_report.yml
  - .github/ISSUE_TEMPLATE/feature_request.yml
  - .github/ISSUE_TEMPLATE/config.yml
  - src/feedbackLinks.ts
  - src/ui/feedbackModal.tsx
  - src/ui/layout.ts
  - src/ui/aboutModal.tsx
  - src/content/build/shell.ts
  - src/content/data/help.ts
  - src/content/data/legal.ts
  - index.html
  - README.md
  - SECURITY.md
  - tests/unit/feedbackLinks.test.ts
  - tests/feedback.spec.ts
---

## Human

Asked whether it's obvious how people could contact them about Partwright
before posting it to Reddit. After learning the only route was a "GitHub" link
in the landing footer, asked to implement all the recommendations in one PR:
an in-app feedback link, issue templates, Discussions, a non-GitHub contact,
and fixing the repo homepage. Chose "GitHub only for now" for contact (no
public email) and said they'd enable Discussions themselves.

## Assistant

- Added a 💬 Feedback button to the editor's left rail. It opens a dialog of
  plain GitHub links; nothing is sent from the app, which keeps the "no data
  leaves your browser" promise. The same dialog is reachable from the command
  palette and the About dialog.
- The bug-report link uses GitHub's issue-form query-param prefill for the
  version and environment fields. The page URL is reduced to origin + path,
  because share links keep the whole design in the hash and a session id sits
  in the query. The URL builders are pure (`src/feedbackLinks.ts`) and
  unit-tested.
- Issue forms tag reports `user-report` so public reports can be told apart
  from the maintainer's internal tracking issues. `blank_issues_enabled: false`
  pushes outsiders to a form. Issues created through the API (by agents) are
  unaffected.
- Added a Feedback section to Help, a Contact section to Legal, and feedback
  links to the landing footer and the prerendered content-page footer.
  SECURITY.md now points to private advisories instead of public issues.
- No `window.partwright` method or AI tool: this only opens external GitHub
  pages, which isn't a modeling capability an agent needs to drive.
- Repo settings (Discussions, the `user-report` label, private vulnerability
  reporting, the homepage URL) can't be changed from this environment. They
  are listed in the PR as manual steps.
