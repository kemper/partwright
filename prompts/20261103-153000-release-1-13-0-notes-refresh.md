---
session: "01QnZGNNCh3YbMWqwxeUossK"
timestamp: "2026-11-03T15:30:00Z"
model: claude-sonnet-5-5
---

## Human

Refresh the release as needed and deploy v1.13.0.

## Assistant

A parametric-human feature landed on main after the first What's New entry was written, and staging advanced past the bump. The entry would have under-described what ships, so I added one bullet to the 1.13 entry through a docs PR into main rather than editing the release branch. The merge also re-triggers the Cloudflare builds, one of which had failed on the previous head.
