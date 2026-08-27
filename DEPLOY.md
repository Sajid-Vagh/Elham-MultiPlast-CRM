# Elham CRM — Dokploy Deployment Guide

This project has **two services** that are deployed as separate Dokploy Applications:

| App | Dockerfile | Domain example |
|-----|-----------|----------------|
| **API Server** | `Dockerfile.api` | `api.elham.com` |
| **CRM Frontend** | `Dockerfile.crm` | `app.elham.com` |

---

## Prerequisites

- Dokploy installed on your server
- A domain with DNS access
- Your server IP / Dokploy URL ready
- Git repo pushed (already done)

---

## Step 1 — Create a Project

In Dokploy:

1. Go to **Projects** → **Create Project**
2. Name it `elham-crm`
3. Open the project

---

## Step 2 — Add Project-Level Environment Variables

This is the single place you paste all secrets. Both apps will pull from here.

1. Inside the project → **Environment** tab
2. Paste the contents of `.env.production` from the repo
3. **Update these three values before saving:**

```env
SESSION_SECRET=<generate with: openssl rand -hex 32>
FRONTEND_URL=https://app.elham.com
CORS_ORIGINS=https://app.elham.com
VITE_API_URL=https://api.elham.com
```

4. Click **Save**

---

## Step 3 — Create Application 1: API Server

Inside the `elham-crm` project → **Create Application**

### General
- **Name:** `api`
- **Repository:** `https://github.com/Sajid-Vagh/Elham-MultiPlast-CRM`
- **Branch:** `main`

### Build
- **Build Type:** `Dockerfile`
- **Docker File:** `Dockerfile.api`
- **Docker Context Path:** `.` (repo root)
- **Docker Build Stage:** `production`

### Environment Variables
Reference all variables from the project using Dokploy syntax:

```
NODE_ENV=production
PORT=${{project.PORT}}
BASE_PATH=${{project.BASE_PATH}}
SESSION_SECRET=${{project.SESSION_SECRET}}
CORS_ORIGINS=${{project.CORS_ORIGINS}}
FRONTEND_URL=${{project.FRONTEND_URL}}
DATABASE_URL=${{project.DATABASE_URL}}
SUPABASE_URL=${{project.SUPABASE_URL}}
SUPABASE_KEY=${{project.SUPABASE_KEY}}
SUPABASE_SERVICE_ROLE_KEY=${{project.SUPABASE_SERVICE_ROLE_KEY}}
SMTP_HOST=${{project.SMTP_HOST}}
SMTP_PORT=${{project.SMTP_PORT}}
SMTP_USER=${{project.SMTP_USER}}
SMTP_PASS=${{project.SMTP_PASS}}
SMTP_FROM=${{project.SMTP_FROM}}
GOOGLE_CLIENT_ID=${{project.GOOGLE_CLIENT_ID}}
GOOGLE_CLIENT_SECRET=${{project.GOOGLE_CLIENT_SECRET}}
BOOTSTRAP_ADMIN_EMAIL=${{project.BOOTSTRAP_ADMIN_EMAIL}}
GSTVERIFY_API_KEY=${{project.GSTVERIFY_API_KEY}}
GSTVERIFY_BASE_URL=${{project.GSTVERIFY_BASE_URL}}
GST_API_URL=${{project.GST_API_URL}}
GST_API_KEY=${{project.GST_API_KEY}}
RAPIDAPI_GST_KEY=${{project.RAPIDAPI_GST_KEY}}
RAPIDAPI_GST_HOST=${{project.RAPIDAPI_GST_HOST}}
```

### Domain
- **Host:** `api.elham.com`
- **Port:** `8080`
- **HTTPS:** enable (Let'\''s Encrypt)

### Deploy
Click **Deploy** and wait for the build to finish.
Check logs — you should see `Server listening on port 8080`.

---

## Step 4 — Create Application 2: CRM Frontend

Inside the `elham-crm` project → **Create Application**

### General
- **Name:** `crm`
- **Repository:** `https://github.com/Sajid-Vagh/Elham-MultiPlast-CRM`
- **Branch:** `main`

### Build
- **Build Type:** `Dockerfile`
- **Docker File:** `Dockerfile.crm`
- **Docker Context Path:** `.` (repo root)
- **Docker Build Stage:** `production`

### Build Arguments
> Vite bakes `VITE_API_URL` into the JS bundle at build time — it must be a build arg, not a runtime env var.

```
VITE_API_URL=${{project.VITE_API_URL}}
PORT=80
BASE_PATH=/
```

### Environment Variables
The CRM is pure static files — no runtime env vars needed.

### Domain
- **Host:** `app.elham.com`
- **Port:** `80`
- **HTTPS:** enable (Let'\''s Encrypt)

### Deploy
Click **Deploy** and wait for the build.
Visit `https://app.elham.com` — you should see the login page.

---

## Step 5 — DNS Setup

Point both subdomains to your server IP:

| Type | Name | Value |
|------|------|-------|
| A | `api` | `<your-server-ip>` |
| A | `app` | `<your-server-ip>` |

DNS propagation can take up to 10 minutes.

---

## Step 6 — First-Admin Bootstrap

Once deployed:

1. Visit `https://app.elham.com/login`
2. The **First Admin Setup** panel appears on the right (only on a fresh DB)
3. Register with the email set in `BOOTSTRAP_ADMIN_EMAIL`
4. Check your inbox for the verification email
5. Click the link → you are logged in as Admin

---

## Redeployment

Any `git push` to `main` → go to Dokploy → click **Redeploy** on the relevant app.

To auto-deploy on push, set up a **Webhook** in Dokploy:
- Dokploy app → **Deployments** → **Webhook URL**
- Add it to GitHub → Repo Settings → Webhooks

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| API container fails to start | Check `PORT` env var is set to `8080` |
| CRM shows blank page | Check `VITE_API_URL` build arg is set correctly |
| Login fails | Check `DATABASE_URL` connects to Supabase pooler |
| Emails not sending | Check `SMTP_PASS` is the Gmail app-specific password (not your Gmail password) |
| CORS errors in browser | Check `CORS_ORIGINS` matches exactly `https://app.elham.com` |
