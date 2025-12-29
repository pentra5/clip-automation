import ytdl from '@distube/ytdl-core';
import { put } from '@vercel/blob';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    console.log('📥 Starting download for:', url);

    // Validate YouTube URL
    if (!ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // Get video info with agent to avoid bot detection
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
      }
    });

    const title = info.videoDetails.title;
    const duration = parseInt(info.videoDetails.lengthSeconds);
    const videoId = info.videoDetails.videoId;

    console.log(`📹 Video: ${title} (${duration}s)`);

    // Get format - prefer smaller quality for faster processing
    const format = ytdl.chooseFormat(info.formats, {
      quality: '18', // 360p mp4 - faster download
      filter: 'videoandaudio'
    }) || ytdl.chooseFormat(info.formats, {
      quality: 'lowest',
      filter: 'videoandaudio'
    });

    if (!format) {
      return res.status(400).json({ error: 'No suitable format found' });
    }

    // Download video as buffer
    const chunks = [];
    const videoStream = ytdl(url, {
      format,
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
      }
    });

    for await (const chunk of videoStream) {
      chunks.push(chunk);
    }

    const videoBuffer = Buffer.concat(chunks);
    console.log(`✅ Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Upload to Vercel Blob Storage
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
    const fileName = `${Date.now()}_${safeTitle}.mp4`;

    const blob = await put(fileName, videoBuffer, {
      access: 'public',
      addRandomSuffix: true,
    });

    console.log('☁️ Uploaded to:', blob.url);

    return res.status(200).json({
      success: true,
      videoUrl: blob.url,
      videoPath: fileName,
      duration,
      title,
      videoId
    });

  } catch (error) {
    console.error('❌ Download error:', error);
    return res.status(500).json({
      error: error.message,
      details: 'Failed to download YouTube video. YouTube may be blocking this request.'
    });
  }
}
