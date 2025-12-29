export const config = {
  maxDuration: 60,
};

// Instead of downloading YouTube, we just validate and return video info
// Gemini can analyze YouTube URLs directly!
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

    // Extract video ID from various YouTube URL formats
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);

    if (!videoIdMatch) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const videoId = videoIdMatch[1];
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Fetch video info from YouTube oEmbed API (no auth required)
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`;
    const infoResponse = await fetch(oembedUrl);

    if (!infoResponse.ok) {
      return res.status(400).json({ error: 'Video not found or is private' });
    }

    const info = await infoResponse.json();

    console.log(`📹 Video: ${info.title}`);

    // For Gemini analysis, we can use YouTube URL directly
    // Gemini has access to public YouTube videos
    return res.status(200).json({
      success: true,
      videoUrl: youtubeUrl,
      videoId: videoId,
      title: info.title,
      author: info.author_name,
      thumbnail: info.thumbnail_url,
      // Note: oEmbed doesn't provide duration, Gemini will detect it
      duration: null,
      note: 'Use this YouTube URL directly with Gemini for video analysis'
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      error: error.message,
      details: 'Failed to process YouTube URL'
    });
  }
}
