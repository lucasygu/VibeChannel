# VibeChannel Web

Simple Next.js landing page and GitHub OAuth callback handler for VibeChannel, deployed to GitHub Pages.

## Live Site

**URL:** https://lucasygu.github.io/VibeChannel/

## Features

- Landing page with project overview
- GitHub OAuth callback handler for VSCode extension
- Built with Next.js 14 and shadcn/ui
- Static export for GitHub Pages deployment

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Deployment

The site automatically deploys to GitHub Pages when changes are pushed to `web/` on the `master` branch.

Manual deployment:
```bash
npm run build
# Output in ./out directory
```

## OAuth Callback

The `/oauth/callback` route handles GitHub OAuth redirects from the VSCode extension.

**Callback URL:** https://lucasygu.github.io/VibeChannel/oauth/callback

See [GitHub OAuth Setup Guide](../docs/github-oauth-setup.md) for configuration details.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Styling:** Tailwind CSS
- **Components:** shadcn/ui
- **Icons:** Lucide React
- **Deployment:** GitHub Pages (static export)

## Project Structure

```
web/
├── app/
│   ├── layout.tsx           # Root layout
│   ├── page.tsx             # Landing page
│   ├── globals.css          # Global styles
│   └── oauth/
│       └── callback/
│           └── page.tsx     # OAuth callback handler
├── components/
│   └── ui/                  # shadcn/ui components
├── lib/
│   └── utils.ts             # Utility functions
├── public/
│   └── .nojekyll           # Disable Jekyll on GitHub Pages
└── next.config.js           # Next.js configuration
```

## Configuration

### Base Path

The site is configured with `basePath: '/VibeChannel'` for GitHub Pages deployment under the repository path.

### Static Export

Uses `output: 'export'` for static HTML generation compatible with GitHub Pages.

## License

MIT
