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
    console.log('📥 Processing YouTube URL:', url);

    // Extract video ID
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);

    if (!videoIdMatch) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const videoId = videoIdMatch[1];
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Try Cobalt API first
    console.log('🔄 Trying Cobalt API...');

    try {
      const cobaltResponse = await fetch('https://api.cobalt.tools/api/json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          url: youtubeUrl,
          vCodec: 'h264',
          vQuality: '480',
          aFormat: 'mp3',
          isAudioOnly: false
        })
      });

      const cobaltData = await cobaltResponse.json();

      if (cobaltData.status === 'stream' || cobaltData.status === 'redirect') {
        const videoDirectUrl = cobaltData.url;

        console.log('✅ Cobalt success! Downloading video...');

        // Download the video from Cobalt URL
        const videoResponse = await fetch(videoDirectUrl);
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

        console.log(`📁 Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        // Upload to Vercel Blob
        const fileName = `${Date.now()}_${videoId}.mp4`;
        const blob = await put(fileName, videoBuffer, {
          access: 'public',
          addRandomSuffix: true,
        });

        console.log('☁️ Uploaded to:', blob.url);

        // Get video info from oEmbed
        const infoResponse = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`);
        const info = await infoResponse.json();

        return res.status(200).json({
          success: true,
          videoUrl: blob.url,
          youtubeUrl: youtubeUrl,
          videoId: videoId,
          title: info.title || 'Unknown',
          author: info.author_name || 'Unknown',
          source: 'cobalt'
        });
      }
    } catch (cobaltError) {
      console.log('⚠️ Cobalt failed:', cobaltError.message);
    }

    // Fallback: Return YouTube URL for Gemini analysis
    console.log('🔄 Fallback: Using YouTube URL directly');

    const infoResponse = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`);
    const info = await infoResponse.json();

    return res.status(200).json({
      success: true,
      videoUrl: youtubeUrl, // YouTube URL for Gemini
      youtubeUrl: youtubeUrl,
      videoId: videoId,
      title: info.title || 'Unknown',
      author: info.author_name || 'Unknown',
      source: 'youtube-direct',
      note: 'Direct download failed, using YouTube URL. Gemini can analyze this, but Groq cannot transcribe.'
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      error: error.message,
      details: 'Failed to process YouTube URL'
    });
  }
}
