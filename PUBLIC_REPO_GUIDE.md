# Public Repository Guide

The public source repository should contain the CLI, headless model, FastAPI data/export services, Excel template, and setup documentation.

Before publishing changes:

- Keep real `EDGAR_IDENTITY` values and local `.env` files out of source control.
- Keep generated workbooks, backend cache databases, virtual environments, and `node_modules` out of commits.
- Check that the README setup instructions match the current CLI command and backend requirements.
- Preserve the model and backend lock/configuration files used for a reproducible source install.

The public interface is `npm run dcf -- <ticker> [--output <file.xlsx>] [--force]`.
