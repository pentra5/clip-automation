# 🎬 Video Clipper API

Vercel serverless functions for video downloading, clipping, and subtitle burning.

## 📦 Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/download-youtube` | POST | Download YouTube video |
| `/api/clip-video` | POST | Clip video segment |
| `/api/burn-subtitle` | POST | Burn SRT subtitles to video |

## 🚀 Quick Deploy

### 1. Setup Vercel Blob Storage

```bash
# Login to Vercel
vercel login

# Link project
vercel link

# Add Blob storage
vercel blob add
```

### 2. Deploy

```bash
npm install
vercel --prod
```

### 3. Get your URL
After deploy, you'll get URL like: `https://video-clipper-api-xxx.vercel.app`

## 📡 API Usage

### Download YouTube Video
```bash
curl -X POST https://your-app.vercel.app/api/download-youtube \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtube.com/watch?v=xxx"}'
```

Response:
```json
{
  "success": true,
  "videoUrl": "https://blob.vercel-storage.com/xxx.mp4",
  "duration": 180,
  "title": "Video Title"
}
```

### Clip Video
```bash
curl -X POST https://your-app.vercel.app/api/clip-video \
  -H "Content-Type: application/json" \
  -d '{
    "videoUrl": "https://blob.vercel-storage.com/xxx.mp4",
    "startTime": 30,
    "duration": 15,
    "outputFileName": "clip1.mp4"
  }'
```

### Burn Subtitle
```bash
curl -X POST https://your-app.vercel.app/api/burn-subtitle \
  -H "Content-Type: application/json" \
  -d '{
    "videoUrl": "https://blob.vercel-storage.com/clip.mp4",
    "srtContent": "1\n00:00:00,000 --> 00:00:05,000\nHello World",
    "outputFileName": "final.mp4"
  }'
```

## ⚠️ Limits

- **Max Duration**: 5 minutes per request
- **Memory**: 3GB
- **Video Size**: ~500MB max (Vercel free tier)
- **Blob Storage**: 1GB free, then $0.15/GB

## 🔧 Local Development

```bash
npm install
vercel dev
```

Test at: `http://localhost:3000/api/download-youtube`
