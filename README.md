# openzca

`openzca` is an open-source CLI wrapper around `zca-js` with command structure compatible with `zca-cli.dev/docs`:

- `auth`
- `msg`
- `group`
- `friend`
- `me`
- `account`
- `listen`
- `license`

## Install

```bash
npm install
npm run build
```

Run from source:

```bash
node dist/cli.js --help
```

Optionally link globally:

```bash
npm link
openzca --help
# alias also available
zca --help
```

## Multi-account profiles

- Global option: `--profile <name>`
- Env var: `ZCA_PROFILE=<name>`
- Default profile managed via `account switch`

Profile data is stored in:

- `~/.openzca/profiles/<profile>/credentials.json`
- `~/.openzca/profiles/<profile>/cache/*.json`
- `~/.openzca/profiles.json`

## Typical flow

```bash
# 1) Login
openzca auth login

# 2) Check profile/account
openzca account list
openzca me info

# 3) Send messages
openzca msg send USER_ID "Hello"
openzca msg send GROUP_ID "Hello team" --group
```

## Notes

- `license` commands here are local/offline storage helpers (not remote commercial activation).
- Some media commands accept both local file and repeatable `--url` options.
