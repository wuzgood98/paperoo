# Security Policy

## Reporting a security issue

Please don't report security issues in public GitHub issues, pull requests, or discussions.

Email **[security@paperoo.app](mailto:security@paperoo.app)** instead. Include:

- What the problem is and what an attacker could do with it
- Steps to reproduce it, or a proof of concept
- A sample PDF that triggers it, if there is one
- The browser and version you tested in

We'll reply to confirm we got your report, keep you updated while we work on a fix, and credit you when it ships unless you'd rather stay anonymous. Please keep the issue private until a fix is out.

## Supported versions

Only the latest version is supported. That means the live site and the `main` branch.

## What counts

Paperoo runs in the browser, and files are never meant to leave the device. The issues we care about most are:

- Anything that sends a file, or any part of its contents, off the device
- A crafted PDF that runs script or code in the page
- Ways around the security headers or the content security policy
- Exported PDFs that carry hidden data the user didn't add or expect

These don't count:

- Bugs in a dependency that Paperoo doesn't trigger. Report those to the dependency's maintainers.
- Problems that need someone else's device to already be compromised
- Reports that come only from automated scanners, with no working example
