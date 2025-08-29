# Deployment Guide - Agentforce Testing Center

## Quick Railway Deployment (Recommended - 5 minutes)

### Prerequisites
- GitHub account
- Railway account (free tier available)
- OpenAI API key

### Steps

1. **Push to GitHub** (if not already):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Deploy to Railway**:
   - Go to [railway.app](https://railway.app)
   - Click "Deploy from GitHub repo"
   - Select your repository
   - Railway auto-detects Node.js app and deploys

3. **Configure Environment Variables**:
   In Railway dashboard, add:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `NODE_ENV`: production
   - `PORT`: 3000

4. **Access Your App**:
   - Railway provides a URL like: `https://your-app-name.up.railway.app`
   - Share this URL with anyone who needs access

### Environment Variables Setup

**Required**:
- `OPENAI_API_KEY`: Get from [OpenAI Platform](https://platform.openai.com/api-keys)

**Optional** (for Salesforce MIAW integration):
- `SALESFORCE_MESSAGING_DEPLOYMENT_NAME`
- `SALESFORCE_MESSAGING_ORG_ID` 
- `SALESFORCE_MIAW_BASE_URL`

## Alternative: Vercel Deployment

1. **Install Vercel CLI**:
   ```bash
   npm i -g vercel
   ```

2. **Deploy**:
   ```bash
   vercel
   ```

3. **Configure environment variables** in Vercel dashboard

## Alternative: DigitalOcean App Platform

1. Connect GitHub repository
2. Choose Node.js environment
3. Set environment variables
4. Deploy

## Features Available After Deployment

- ✅ **Web-based interface** - No local setup required
- ✅ **CSV conversation analysis** - Upload and analyze customer conversations  
- ✅ **AI goal generation** - Automatic test goal creation from conversations
- ✅ **Project management** - Organize goals by projects
- ✅ **Batch testing** - Run multiple tests simultaneously
- ✅ **CSV export** - Export results and goals
- ✅ **MIAW integration** - Test Salesforce Agentforce bots (if configured)

## Cost Estimates

- **Railway**: Free tier → $5/month for production
- **Vercel**: Free tier → $20/month for team features  
- **DigitalOcean**: $12/month for basic app
- **OpenAI API**: ~$0.01-0.03 per conversation analysis

## Security Notes

- Environment variables are securely managed by hosting platform
- No sensitive data stored in code repository
- API keys encrypted in transit and at rest
- HTTPS enabled by default