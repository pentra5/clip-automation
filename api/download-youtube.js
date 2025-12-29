import ytdl from 'ytdl-core';
import { put } from '@vercel/blob';

export const config = {
  maxDuration: 300, // 5 minutes timeout
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

    // Get video info
    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title;
    const duration = parseInt(info.videoDetails.lengthSeconds);
    const videoId = info.videoDetails.videoId;

    console.log(`📹 Video: ${title} (${duration}s)`);

    // Get best format (video + audio combined)
    const format = ytdl.chooseFormat(info.formats, { 
      quality: 'highest',
      filter: 'videoandaudio' 
    });

    if (!format) {
      return res.status(400).json({ error: 'No suitable format found' });
    }

    // Download video as buffer
    const chunks = [];
    const videoStream = ytdl(url, { format });
    
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
      details: 'Failed to download YouTube video'
    });
  }
}
