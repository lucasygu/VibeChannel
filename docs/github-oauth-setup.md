# GitHub OAuth App Setup for VibeChannel

This guide explains how to set up a GitHub OAuth application for VibeChannel authentication.

## Overview

VibeChannel uses GitHub OAuth for user authentication. The OAuth callback is handled by a simple Next.js app deployed to GitHub Pages.

- **Landing Page:** https://lucasygu.github.io/VibeChannel/
- **OAuth Callback URL:** https://lucasygu.github.io/VibeChannel/oauth/callback

## Creating the GitHub OAuth App

### 1. Navigate to GitHub OAuth Apps

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **OAuth Apps** in the left sidebar
3. Click **New OAuth App**

### 2. Configure the OAuth App

Fill in the following details:

| Field | Value |
|-------|-------|
| **Application name** | VibeChannel |
| **Homepage URL** | `https://lucasygu.github.io/VibeChannel/` |
| **Application description** | Filesystem-based conversation protocol |
| **Authorization callback URL** | `https://lucasygu.github.io/VibeChannel/oauth/callback` |

### 3. Generate Client Secret

1. After creating the app, click **Generate a new client secret**
2. Copy both the **Client ID** and **Client Secret** immediately
3. Store them securely (you'll need them for the VSCode extension)

## Enabling GitHub Pages

### 1. Configure Repository Settings

1. Go to your repository: https://github.com/lucasygu/VibeChannel
2. Click **Settings** → **Pages**
3. Under **Source**, select:
   - Source: **GitHub Actions**
4. Save the changes

### 2. Deploy the Site

The GitHub Pages site will automatically deploy when you:
- Push changes to the `web/` directory on the `master` branch
- Manually trigger the workflow from Actions tab

After deployment, the site will be available at:
https://lucasygu.github.io/VibeChannel/

## Using OAuth in VSCode Extension

### Environment Variables

Add the OAuth credentials to `extension/.env.local`:

```bash
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
```

### Integration Flow

1. User clicks "Sign in with GitHub" in the extension
2. Extension opens OAuth authorization URL:
   ```
   https://github.com/login/oauth/authorize?client_id=CLIENT_ID&redirect_uri=CALLBACK_URL&scope=read:user
   ```
3. User authorizes the app on GitHub
4. GitHub redirects to: `https://lucasygu.github.io/VibeChannel/oauth/callback?code=CODE`
5. Callback page receives the code and sends it back to the extension
6. Extension exchanges the code for an access token
7. Extension uses the token for GitHub API requests

## Local Development

### Running the Web App Locally

```bash
cd web
npm install
npm run dev
```

The app will be available at http://localhost:3000/VibeChannel/

### Testing OAuth Locally

For local testing, you can create a separate OAuth app with:
- **Authorization callback URL:** `http://localhost:3000/VibeChannel/oauth/callback`

## Troubleshooting

### OAuth Callback Not Working

1. Verify the callback URL exactly matches in GitHub OAuth app settings
2. Check browser console for errors
3. Ensure GitHub Pages is deployed and accessible

### Extension Not Receiving Code

1. Check that the callback page is opening in a new window (not a tab)
2. Verify `window.opener` is accessible (popup blockers can interfere)
3. Check VSCode extension console for errors

### GitHub Pages Not Deploying

1. Check Actions tab for deployment status
2. Ensure GitHub Pages is enabled in repository settings
3. Verify the workflow file has correct permissions

## Security Notes

- **Never commit** the Client Secret to version control
- Use `extension/.env.local` (git-ignored) for secrets
- The OAuth callback page only receives the authorization code, not the secret
- Access tokens should be stored securely in VSCode's secret storage

## Additional Resources

- [GitHub OAuth Documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Next.js Static Export](https://nextjs.org/docs/app/building-your-application/deploying/static-exports)
- [GitHub Pages Documentation](https://docs.github.com/en/pages)
