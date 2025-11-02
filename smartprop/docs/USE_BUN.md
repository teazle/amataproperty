# 🚫 Always Use Bun, Not npm/npx

This project is configured to use **Bun** exclusively.

## ✅ Correct Commands

### Installing Dependencies
```bash
bun install                    # ✅ Use bun
npm install                    # ❌ DON'T use npm
yarn install                   # ❌ DON'T use yarn
pnpm install                   # ❌ DON'T use pnpm
```

### Running Scripts
```bash
bun dev                        # ✅ Use bun
npm run dev                    # ❌ DON'T use npm
```

### Adding Dependencies
```bash
bun add package-name           # ✅ Use bun
npm install package-name       # ❌ DON'T use npm
```

### Using shadcn/ui Components
```bash
bun run shadcn add button      # ✅ Use bun script
bunx shadcn@latest add button  # ✅ Or use bunx
npx shadcn add button          # ❌ DON'T use npx
```

### Running One-off Commands
```bash
bunx some-cli-tool             # ✅ Use bunx
npx some-cli-tool              # ❌ DON'T use npx
```

## 🛡️ Protection Mechanisms

### 1. `.npmrc` File
- Enforces `engine-strict=true`
- Will error if npm is used

### 2. `package.json` Engines
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

### 3. Preinstall Hook
```json
{
  "scripts": {
    "preinstall": "npx only-allow bun"
  }
}
```
This will block npm/yarn/pnpm and show a helpful error.

### 4. Custom Scripts
```json
{
  "scripts": {
    "shadcn": "bunx shadcn@latest"
  }
}
```
Use: `bun run shadcn add tabs`

## 📋 Quick Reference

| Task | ✅ Correct Command | ❌ Wrong Command |
|------|-------------------|------------------|
| Install deps | `bun install` | `npm install` |
| Run dev | `bun dev` | `npm run dev` |
| Add package | `bun add react` | `npm install react` |
| Add shadcn | `bun run shadcn add tabs` | `npx shadcn add tabs` |
| Run script | `bun run build` | `npm run build` |
| Execute CLI | `bunx prisma` | `npx prisma` |

## 🎯 Why Bun?

1. **Faster** - 10-20x faster than npm
2. **Native TypeScript** - No need for ts-node
3. **Built-in tools** - Test runner, bundler included
4. **Compatible** - Works with npm packages
5. **Modern** - Built for modern JS/TS development

## 🚨 If You Accidentally Use npm

If you accidentally run `npm install`:
1. Delete `node_modules/`
2. Delete `package-lock.json`
3. Run `bun install`

## 🔧 Setup for New Team Members

```bash
# Install bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone <repo>
cd smartprop
bun install
bun dev
```

## 📝 CI/CD Configuration

For GitHub Actions or other CI:
```yaml
- uses: oven-sh/setup-bun@v1
  with:
    bun-version: latest

- run: bun install
- run: bun run build
```

---

**Remember**: When in doubt, replace `npm` or `npx` with `bun` or `bunx`! 🐰

