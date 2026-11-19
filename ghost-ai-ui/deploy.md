# 🚀 GhostAI Deployment Guide

Complete step-by-step guide to deploy **GhostAI** to production on **Vercel**, **Netlify**, or any **Custom Domain / VPS (Docker/Node)**.

---

## 📋 Table of Contents
1. [Important Architecture Notes](#-important-architecture-notes)
2. [Required Environment Variables](#-required-environment-variables)
3. [Deploying to Vercel (Recommended)](#-deploying-to-vercel-recommended)
   - [Method A: Vercel Dashboard (Git Integration)](#method-a-vercel-dashboard-git-integration)
   - [Method B: Vercel CLI](#method-b-vercel-cli)
   - [Connecting a Custom Domain on Vercel](#connecting-a-custom-domain-on-vercel)
4. [Deploying to Netlify](#-deploying-to-netlify)
5. [Deploying to a VPS / Cloud Server (Docker & PM2)](#-deploying-to-a-vps--cloud-server)
   - [Option A: Docker Deployment](#option-a-docker-deployment)
   - [Option B: PM2 + Nginx + Certbot (Let's Encrypt SSL)](#option-b-pm2--nginx--certbot-lets-encrypt-ssl)
6. [Post-Deployment Verification Checklist](#-post-deployment-verification-checklist)

---

## ⚡ Important Architecture Notes

* **Monorepo / Subfolder Root**: The Next.js application lives inside the **`ghost-ai-ui`** subfolder of this repository. When deploying to any platform (Vercel, Netlify, Render), you **must set the Root Directory to `ghost-ai-ui`**.
* **Edge Runtime Routes**: The chat streaming route (`/api/chat`) and purge beacon (`/api/chat/purge`) use Next.js Edge Runtime (`export const runtime = 'edge'`). Platforms like Vercel and Netlify support this natively out-of-the-box with low-latency global edge streaming.
* **HTTPS Requirement**: Production deployment with HTTPS automatically activates the browser's native **Web Crypto API** (`crypto.randomUUID()` and `crypto.subtle.digest()`). Both Vercel and Netlify provision SSL certificates automatically for free.

---

## 🔑 Required Environment Variables

Before deploying, prepare the following environment variables:

| Variable Name | Required | Default / Description |
| :--- | :---: | :--- |
| `GOOGLE_API_KEY` | **Yes** | Google Gemini API key used for high-speed multi-model fallback streaming. |
| `OPENROUTER_API_KEY_1` | Optional | OpenRouter API Key for Column 1 stream (e.g., GPT OSS 20B). |
| `OPENROUTER_API_KEY_2` | Optional | OpenRouter API Key for Column 2 stream (e.g., Gemma / Llama). |
| `OPENROUTER_API_KEY_3` | Optional | OpenRouter API Key for Column 3 stream (e.g., Nemotron). |
| `NEXT_PUBLIC_NETWORK_ID` | Optional | Midnight network identifier (`undeployed`, `testnet`, or `mainnet`). |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Optional | Deployed Proof-of-Existence Midnight smart contract address. |

> **Tip:** If OpenRouter keys are omitted or rate-limited, the backend automatically routes requests through `GOOGLE_API_KEY` to guarantee uninterrupted multi-stream responses.

---

## ▲ Deploying to Vercel (Recommended)

Vercel provides native Next.js Edge streaming, automatic HTTPS, and zero-configuration CI/CD.

### Method A: Vercel Dashboard (Git Integration)

1. **Push your repository** to GitHub, GitLab, or Bitbucket.
2. Go to the [Vercel Dashboard](https://vercel.com/dashboard) and click **"Add New..." → "Project"**.
3. Select your repository and click **Import**.
4. In the **Configure Project** screen, configure the following:
   * **Project Name**: `ghost-ai` (or your preferred name)
   * **Framework Preset**: `Next.js`
   * **Root Directory**: Click **Edit** and select **`ghost-ai-ui`** ⚠️ *(Critical step!)*
   * **Build Command**: `npm run build` (or leave default `next build --webpack`)
   * **Output Directory**: `.next`
   * **Install Command**: `npm install`
5. Expand the **Environment Variables** section and add:
   * `GOOGLE_API_KEY` = `your_gemini_api_key`
   * *(Optional)* `OPENROUTER_API_KEY_1`, `OPENROUTER_API_KEY_2`, `OPENROUTER_API_KEY_3`
   * `NEXT_PUBLIC_NETWORK_ID` = `undeployed` (or your testnet ID)
   * `NEXT_PUBLIC_CONTRACT_ADDRESS` = `5681d5e55d4705159466441be78c1a5eaa80dd8a15d68a90166a0792ec3e9d97`
6. Click **Deploy**.
7. In ~60 seconds, your site will be live at `https://ghost-ai-xxx.vercel.app`!

---

### Method B: Vercel CLI

You can also deploy directly from your local terminal:

```bash
# 1. Install Vercel CLI globally
npm i -g vercel

# 2. Navigate to the ghost-ai-ui directory
cd ghost-ai-ui

# 3. Log in to your Vercel account
vercel login

# 4. Deploy preview build
vercel

# 5. Deploy to production
vercel --prod
```

When prompted:
* `Set up and deploy?` → **Y**
* `Which scope?` → Select your account
* `Link to existing project?` → **N**
* `Project name?` → `ghost-ai`
* `In which directory is your code located?` → **`./`**

Then add environment variables using the CLI:
```bash
vercel env add GOOGLE_API_KEY production
```

---

### Connecting a Custom Domain on Vercel

To connect any domain (e.g., `ghostai.io`, `yourdomain.com`, `app.yourdomain.com`):

1. Go to your project in the **Vercel Dashboard**.
2. Click **Settings → Domains**.
3. Type your custom domain and click **Add**.
4. Vercel will display the required DNS records:
   * **Apex Domain (`yourdomain.com`)**:
     * Type: `A`
     * Name: `@`
     * Value: `76.76.21.21`
   * **Subdomain (`app.yourdomain.com`)**:
     * Type: `CNAME`
     * Name: `app`
     * Value: `cname.vercel-dns.com`
5. Go to your domain registrar (Namecheap, GoDaddy, Cloudflare, Google Domains, Porkbun, etc.) and add these DNS records.
6. Once DNS propagates (typically 1–15 minutes), Vercel automatically generates a free SSL certificate.

---

## 🌐 Deploying to Netlify

1. Go to [Netlify](https://app.netlify.com/) and click **"Add new site" → "Import an existing project"**.
2. Connect your Git provider and select this repository.
3. In **Build settings**:
   * **Base directory**: `ghost-ai-ui`
   * **Build command**: `npm run build`
   * **Publish directory**: `ghost-ai-ui/.next`
4. In **Environment variables**, add `GOOGLE_API_KEY` and optional OpenRouter keys.
5. Click **Deploy site**.
6. Under **Domain management**, click **"Add custom domain"** to attach your own domain with free Let's Encrypt SSL.

---

## 🖥️ Deploying to a VPS / Cloud Server

For self-hosting on AWS EC2, DigitalOcean Droplet, Hetzner, Linode, or any Linux server:

### Option A: Docker Deployment

Create a `Dockerfile` inside `ghost-ai-ui/`:

```dockerfile
# ghost-ai-ui/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["npm", "start"]
```

Build and run:
```bash
cd ghost-ai-ui
docker build -t ghost-ai-ui .
docker run -d -p 3000:3000 \
  -e GOOGLE_API_KEY="your_api_key" \
  --name ghost-ai ghost-ai-ui
```

---

### Option B: PM2 + Nginx + Certbot (Let's Encrypt SSL)

On your Ubuntu/Debian server:

#### 1. Setup Node.js & Clone Code
```bash
# Install Node.js 20 & PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx
sudo npm install -g pm2

# Clone and build
git clone <your-repo-url>
cd midnight_hack/1/ghost-ai-ui
npm install
npm run build
```

#### 2. Start with PM2
```bash
pm2 start npm --name "ghost-ai" -- start -- -p 3000
pm2 save
pm2 startup
```

#### 3. Configure Nginx Reverse Proxy
Edit `/etc/nginx/sites-available/ghost-ai`:
```nginx
server {
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # SSE Streaming headers (Crucial for AI chat streams)
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_set_header X-Accel-Buffering no;
    }
}
```

Enable site and test:
```bash
sudo ln -s /etc/nginx/sites-available/ghost-ai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 4. Enable Free SSL Certificate
```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot will automatically renew your certificates every 90 days.

---

## ✅ Post-Deployment Verification Checklist

Once deployed to your domain, test the following checklist:

- [ ] **Landing Page**: Check that the landing hero renders cleanly with dark cyberpunk glassmorphism.
- [ ] **Enter Ghost Mode**: Click the **"Enter Ghost Mode"** button to ensure seamless transition into the chat dashboard.
- [ ] **Single Model Chat**: Send a message to verify real-time SSE streaming.
- [ ] **Multi-Model Comparison**: Open the model selector, toggle **Comparison Mode**, select 3 models, and send a message to verify parallel streaming columns.
- [ ] **☢️ Nuke Protocol**: Click **"Forget This Conversation"** twice (3s arm window) to test purge signal and sessionStorage wipe.
- [ ] **Proof-of-Existence**: Click **"Connect Wallet"** → **"Seal Matrix"** to generate a cryptographic hash anchor.
- [ ] **Integrity Verification**: Click **"Verify Authenticity"** to confirm SHA-256 state matching.
