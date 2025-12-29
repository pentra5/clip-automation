import { put } from '@vercel/blob';

export const config = {
  maxDuration: 60,
};

// RapidAPI YouTube Downloader - FREE: 20 requests/day
// Get your API key from: https://rapidapi.com/ytjar/api/youtube-video-download-info
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';

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

    // Method 1: Try RapidAPI if key is configured
    if (RAPIDAPI_KEY) {
      console.log('🔄 Trying RapidAPI...');
      try {
        const rapidResponse = await fetch(`https://youtube-video-download-info.p.rapidapi.com/dl?id=${videoId}`, {
          method: 'GET',
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': 'youtube-video-download-info.p.rapidapi.com'
          }
        });

        if (rapidResponse.ok) {
          const rapidData = await rapidResponse.json();

          // Find 360p or 480p format (smaller for faster processing)
          const formats = rapidData.link || {};
          let downloadUrl = null;
          let quality = null;

          // Try to find a good quality
          for (const [q, links] of Object.entries(formats)) {
            if (q.includes('360') || q.includes('480') || q.includes('720')) {
              if (Array.isArray(links) && links.length > 0) {
                downloadUrl = links[0];
                quality = q;
                break;
              }
            }
          }

          if (downloadUrl) {
            console.log(`✅ RapidAPI success! Quality: ${quality}`);

            // Download the video
            const videoResponse = await fetch(downloadUrl);
            const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
            console.log(`📁 Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

            // Upload to Vercel Blob
            const fileName = `${Date.now()}_${videoId}.mp4`;
            const blob = await put(fileName, videoBuffer, {
              access: 'public',
              addRandomSuffix: true,
            });

            console.log('☁️ Uploaded to:', blob.url);

            return res.status(200).json({
              success: true,
              videoUrl: blob.url,
              youtubeUrl: youtubeUrl,
              videoId: videoId,
              title: rapidData.title || 'Unknown',
              author: rapidData.author || 'Unknown',
              duration: rapidData.duration,
              source: 'rapidapi'
            });
          }
        }
      } catch (rapidError) {
        console.log('⚠️ RapidAPI failed:', rapidError.message);
      }
    }

    // Method 2: Try savetube API (free, no key needed)
    console.log('🔄 Trying SaveTube API...');
    try {
      const savetubeResponse = await fetch('https://api.savetube.me/info?url=' + encodeURIComponent(youtubeUrl), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (savetubeResponse.ok) {
        const savetubeData = await savetubeResponse.json();

        if (savetubeData.data && savetubeData.data.video_formats) {
          // Find 360p or 480p
          const format = savetubeData.data.video_formats.find(f =>
            f.quality === '360p' || f.quality === '480p' || f.quality === '720p'
          );

          if (format && format.url) {
            console.log(`✅ SaveTube success! Quality: ${format.quality}`);

            const videoResponse = await fetch(format.url);
            const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
            console.log(`📁 Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

            const fileName = `${Date.now()}_${videoId}.mp4`;
            const blob = await put(fileName, videoBuffer, {
              access: 'public',
              addRandomSuffix: true,
            });

            return res.status(200).json({
              success: true,
              videoUrl: blob.url,
              youtubeUrl: youtubeUrl,
              videoId: videoId,
              title: savetubeData.data.title || 'Unknown',
              author: savetubeData.data.author || 'Unknown',
              source: 'savetube'
            });
          }
        }
      }
    } catch (savetubeError) {
      console.log('⚠️ SaveTube failed:', savetubeError.message);
    }

    // Method 3: Try y2mate clone API
    console.log('🔄 Trying Y2Mate API...');
    try {
      const y2Response = await fetch(`https://api.vevioz.com/api/button/mp4/${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (y2Response.ok) {
        const html = await y2Response.text();
        // Extract download URL from response
        const urlMatch = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/);

        if (urlMatch && urlMatch[1]) {
          console.log('✅ Y2Mate success!');

          const videoResponse = await fetch(urlMatch[1]);
          const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
          console.log(`📁 Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

          const fileName = `${Date.now()}_${videoId}.mp4`;
          const blob = await put(fileName, videoBuffer, {
            access: 'public',
            addRandomSuffix: true,
          });

          // Get title from oEmbed
          let title = 'Unknown';
          try {
            const infoRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`);
            if (infoRes.ok) {
              const info = await infoRes.json();
              title = info.title;
            }
          } catch (e) { }

          return res.status(200).json({
            success: true,
            videoUrl: blob.url,
            youtubeUrl: youtubeUrl,
            videoId: videoId,
            title: title,
            source: 'y2mate'
          });
        }
      }
    } catch (y2Error) {
      console.log('⚠️ Y2Mate failed:', y2Error.message);
    }

    // All methods failed - return YouTube URL for Gemini only
    console.log('⚠️ All download methods failed');

    let title = 'Unknown';
    try {
      const infoRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`);
      if (infoRes.ok) {
        const info = await infoRes.json();
        title = info.title;
      }
    } catch (e) { }

    return res.status(200).json({
      success: false,
      videoUrl: youtubeUrl,
      youtubeUrl: youtubeUrl,
      videoId: videoId,
      title: title,
      source: 'youtube-direct',
      error: 'All download services failed. Consider adding RAPIDAPI_KEY for reliable downloads.'
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      error: error.message,
      details: 'Failed to process YouTube URL'
    });
  }
}
