# Public Repository Guide

The public source repository should contain the CLI, headless model, FastAPI data/export services, Excel template, and setup documentation.

Before publishing changes:

- Keep real `EDGAR_IDENTITY` values and local `.env` files out of source control.
- Keep generated workbooks, backend cache databases, virtual environments, and `node_modules` out of commits.
- Check that the README setup instructions match the current CLI command and backend requirements.
- Preserve the model and backend lock/configuration files used for a reproducible source install.

The primary interface is `dcf build <ticker>`, `dcf model update <ticker>`,
and the review/export commands documented in the README. Each build produces
a date-and-ticker export plus the stable library copy. `npm run dcf -- build <ticker>`
is the from-checkout form. `dcfbuild <ticker> [--output <file.xlsx>] [--force]`
remains the legacy standalone export command.
