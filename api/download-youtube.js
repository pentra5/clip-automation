import { put } from '@vercel/blob';

export const config = {
  maxDuration: 60,
};

// List of Cobalt instances to try (from cobalt.directory and instances.cobalt.best)
const COBALT_INSTANCES = [
  'https://api.cobalt.tools',
  'https://co.wuk.sh',
  'https://cobalt.api.timelessnesses.me',
  'https://cobalt.canine.tools',
  'https://api.co.eepy.today',
];

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

    // Try each Cobalt instance
    for (const instance of COBALT_INSTANCES) {
      console.log(`🔄 Trying Cobalt instance: ${instance}`);

      try {
        const cobaltResponse = await fetch(`${instance}/api/json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          body: JSON.stringify({
            url: youtubeUrl,
            vCodec: 'h264',
            vQuality: '480',
            aFormat: 'mp3',
            isAudioOnly: false
          })
        });

        if (!cobaltResponse.ok) {
          console.log(`❌ Instance ${instance} returned ${cobaltResponse.status}`);
          continue;
        }

        const cobaltData = await cobaltResponse.json();

        if (cobaltData.status === 'error') {
          console.log(`❌ Instance ${instance} error:`, cobaltData.text);
          continue;
        }

        if (cobaltData.status === 'stream' || cobaltData.status === 'redirect' || cobaltData.url) {
          const videoDirectUrl = cobaltData.url;

          console.log(`✅ Success with ${instance}! Downloading...`);

          // Download the video
          const videoResponse = await fetch(videoDirectUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });

          if (!videoResponse.ok) {
            console.log(`❌ Failed to fetch video from Cobalt URL`);
            continue;
          }

          const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
          console.log(`📁 Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

          // Upload to Vercel Blob
          const fileName = `${Date.now()}_${videoId}.mp4`;
          const blob = await put(fileName, videoBuffer, {
            access: 'public',
            addRandomSuffix: true,
          });

          console.log('☁️ Uploaded to:', blob.url);

          // Get video title from oEmbed
          let title = 'Unknown';
          let author = 'Unknown';
          try {
            const infoResponse = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`);
            if (infoResponse.ok) {
              const info = await infoResponse.json();
              title = info.title;
              author = info.author_name;
            }
          } catch (e) { }

          return res.status(200).json({
            success: true,
            videoUrl: blob.url,
            youtubeUrl: youtubeUrl,
            videoId: videoId,
            title: title,
            author: author,
            source: 'cobalt',
            instance: instance
          });
        }
      } catch (instanceError) {
        console.log(`❌ Instance ${instance} failed:`, instanceError.message);
        continue;
      }
    }

    // All Cobalt instances failed - fallback to YouTube URL
    console.log('⚠️ All Cobalt instances failed, using YouTube URL directly');

    let title = 'Unknown';
    let author = 'Unknown';
    try {
      const infoResponse = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`);
      if (infoResponse.ok) {
        const info = await infoResponse.json();
        title = info.title;
        author = info.author_name;
      }
    } catch (e) { }

    return res.status(200).json({
      success: true,
      videoUrl: youtubeUrl,
      youtubeUrl: youtubeUrl,
      videoId: videoId,
      title: title,
      author: author,
      source: 'youtube-direct',
      note: 'All download services failed. Use this URL with Gemini only.'
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      error: error.message,
      details: 'Failed to process YouTube URL'
    });
  }
}
