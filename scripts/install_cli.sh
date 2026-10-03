#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${HOME}/.local/bin"
# Runtime-idempotent so login shells that source both .zprofile and .zshrc
# (zsh) or .bash_profile and .bashrc (bash) never prepend the bin directory twice.
PATH_LINE='case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH";; esac'

mkdir -p "$BIN_DIR"

for CLI_NAME in dcf dcfbuild; do
  CLI_TARGET="${BIN_DIR}/${CLI_NAME}"
  CLI_SOURCE="${PROJECT_ROOT}/bin/${CLI_NAME}.mjs"
  if [[ -L "$CLI_TARGET" ]]; then
    if [[ "$(readlink "$CLI_TARGET")" != "$CLI_SOURCE" ]]; then
      printf 'Refusing to replace a different %s link at %s\n' "$CLI_NAME" "$CLI_TARGET" >&2
      exit 1
    fi
  elif [[ -e "$CLI_TARGET" ]]; then
    printf 'Refusing to replace an existing file at %s\n' "$CLI_TARGET" >&2
    exit 1
  fi
done

for CLI_NAME in dcf dcfbuild; do
  CLI_TARGET="${BIN_DIR}/${CLI_NAME}"
  CLI_SOURCE="${PROJECT_ROOT}/bin/${CLI_NAME}.mjs"
  if [[ ! -L "$CLI_TARGET" ]]; then
    ln -s "$CLI_SOURCE" "$CLI_TARGET"
  fi
done

# Add ~/.local/bin to the login startup file for the user's shell.
if [[ ":${PATH:-}:" != *":${BIN_DIR}:"* ]]; then
  case "$(basename "${SHELL:-/bin/sh}")" in
    zsh)
      # Login shells read ~/.zprofile; interactive non-login terminals read ~/.zshrc.
      STARTUP_FILES=("${HOME}/.zprofile" "${HOME}/.zshrc")
      ;;
    bash)
      # Login shells read ~/.bash_profile; interactive non-login Linux terminals read ~/.bashrc.
      STARTUP_FILES=("${HOME}/.bash_profile" "${HOME}/.bashrc")
      ;;
    *)
      STARTUP_FILES=("${HOME}/.profile")
      ;;
  esac
  for STARTUP_FILE in "${STARTUP_FILES[@]}"; do
    if [[ -f "$STARTUP_FILE" ]] && grep -Fqx "$PATH_LINE" "$STARTUP_FILE"; then
      continue
    fi
    printf '\n# DCF CLI\n%s\n' "$PATH_LINE" >> "$STARTUP_FILE"
  done
fi

printf 'Installed dcf and dcfbuild under %s\n' "$BIN_DIR"
printf 'Open a new terminal window if the command is not on the current PATH.\n'
