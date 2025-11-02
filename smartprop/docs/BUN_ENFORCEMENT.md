# 🛡️ Bun Enforcement - Protection Mechanisms

This document explains all the safeguards in place to prevent accidental npm usage.

## 🚨 Active Protections

### 1. **.npmrc** File
```
engine-strict=true
```
- Forces strict engine checking
- Will error if package manager doesn't match

### 2. **package.json Engines**
```json
{
  "engines": {
    "bun": ">=1.0.0",
    "npm": "please-use-bun",
    "yarn": "please-use-bun",
    "pnpm": "please-use-bun"
  }
}
```
- Shows clear message if wrong package manager used
- `npm`, `yarn`, `pnpm` set to error message instead of version

### 3. **Preinstall Hook**
```json
{
  "scripts": {
    "preinstall": "npx only-allow bun"
  }
}
```
- Runs before any install command
- Blocks npm/yarn/pnpm with helpful error:
  ```
  Use "bun install" for installation in this project
  ```

### 4. **Custom Scripts**
```json
{
  "scripts": {
    "shadcn": "bunx shadcn@latest"
  }
}
```
- Provides easy shortcuts for common tasks
- Usage: `bun run shadcn add button`

### 5. **.bunrc** (Workspace Root)
```
[install]
lockfile = true
exact = false
peer = true

[run]
bun = true
```
- Configures bun behavior
- Ensures consistent usage across projects

## 🧪 Test the Protection

Try running these (they should fail):
```bash
npm install              # ❌ Blocked by preinstall
yarn install             # ❌ Blocked by preinstall
pnpm install             # ❌ Blocked by preinstall
```

Should see error:
```
Use "bun install" for installation in this project
```

## ✅ Correct Usage

```bash
# Install dependencies
bun install

# Run dev server
bun dev

# Add packages
bun add package-name
bun add -D dev-package

# Remove packages
bun remove package-name

# Run scripts
bun run build
bun run lint

# Use shadcn
bun run shadcn add tabs

# Execute CLIs
bunx prisma
bunx create-next-app
```

## 📁 Files Involved

1. `smartprop/.npmrc` - npm configuration
2. `smartprop/package.json` - engines and scripts
3. `.bunrc` - workspace-level bun config
4. `smartprop/USE_BUN.md` - user documentation

## 🔧 How It Works

### Scenario 1: User tries `npm install`

```
1. npm starts install process
2. Reads package.json
3. Sees "preinstall" script
4. Runs: npx only-allow bun
5. only-allow checks current package manager
6. Detects npm (not bun)
7. ❌ Exits with error message
8. Install cancelled
```

### Scenario 2: User tries `npm install --legacy-peer-deps`

```
1. npm starts with flags
2. Still runs preinstall hook
3. ❌ Still blocked
```

### Scenario 3: User uses `bun install`

```
1. bun starts install process
2. Reads package.json
3. Sees "preinstall" script
4. Runs: npx only-allow bun
5. only-allow checks current package manager
6. Detects bun
7. ✅ Allows installation
8. Install continues normally
```

## 🚀 CI/CD Configuration

For GitHub Actions:
```yaml
name: Deploy

on: push

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      # ✅ Install Bun
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      
      # ✅ Use Bun commands
      - run: bun install
      - run: bun run build
      - run: bun run lint
```

## 📝 Onboarding New Developers

Share this checklist:

1. ✅ Install Bun: `curl -fsSL https://bun.sh/install | bash`
2. ✅ Clone repo: `git clone ...`
3. ✅ Install deps: `bun install` (NOT `npm install`)
4. ✅ Run dev: `bun dev`
5. ✅ Read: `USE_BUN.md`

## 🐛 Troubleshooting

### "only-allow: command not found"
```bash
# Install only-allow globally
bun add -g only-allow

# Or install locally in project
bun add -D only-allow
```

### Package Lock Confusion
If you see both `bun.lockb` and `package-lock.json`:
```bash
# Remove npm lock file
rm package-lock.json

# Reinstall with bun
rm -rf node_modules
bun install
```

### CI/CD Still Uses npm
Update your CI config to use bun:
```yaml
- uses: oven-sh/setup-bun@v1
- run: bun install
```

## 📊 Comparison

| Protection | npm | yarn | pnpm | bun |
|------------|-----|------|------|-----|
| .npmrc | ❌ Blocks | ❌ Blocks | ❌ Blocks | ✅ Allows |
| engines | ❌ Blocks | ❌ Blocks | ❌ Blocks | ✅ Allows |
| preinstall | ❌ Blocks | ❌ Blocks | ❌ Blocks | ✅ Allows |

## ✨ Benefits

1. **No Confusion** - Everyone uses the same tool
2. **Faster** - Bun is 10-20x faster than npm
3. **Consistent** - Same lockfile across team
4. **Fewer Bugs** - No "works on my machine" issues
5. **Automatic** - Protection is automatic, no manual checks

## 🎯 Summary

With these protections in place:
- ✅ Impossible to accidentally use npm
- ✅ Clear error messages guide users
- ✅ Bun usage enforced automatically
- ✅ CI/CD can be configured correctly
- ✅ New developers are guided properly

**The project is now npm-proof!** 🛡️

