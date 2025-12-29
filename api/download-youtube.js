import { put } from '@vercel/blob';

export const config = {
  maxDuration: 60,
};

// RapidAPI YouTube Media Downloader
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '32fb7fcd39mshc9d70e0c11d85f4p110d9fjsn719485e42656';

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

    console.log('🔄 Calling RapidAPI YouTube Media Downloader...');

    // Call RapidAPI - request both videos and audios
    const rapidResponse = await fetch(
      `https://youtube-media-downloader.p.rapidapi.com/v2/video/details?videoId=${videoId}&urlAccess=normal&videos=true&audios=true&subtitles=false&related=false`,
      {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': RAPIDAPI_KEY,
          'X-RapidAPI-Host': 'youtube-media-downloader.p.rapidapi.com'
        }
      }
    );

    if (!rapidResponse.ok) {
      const errorText = await rapidResponse.text();
      console.log('❌ RapidAPI error:', rapidResponse.status, errorText);
      throw new Error(`RapidAPI returned ${rapidResponse.status}`);
    }

    const rapidData = await rapidResponse.json();
    console.log('✅ RapidAPI response received');
    console.log('📊 Videos count:', rapidData.videos?.length || 0);
    console.log('📊 Audios count:', rapidData.audios?.length || 0);

    let downloadUrl = null;
    let quality = null;
    let title = rapidData.title || 'Unknown';
    let author = rapidData.channel?.name || 'Unknown';
    let duration = rapidData.lengthSeconds || 0;

    // Look for videos - prioritize ones with audio, but accept any
    if (rapidData.videos && Array.isArray(rapidData.videos) && rapidData.videos.length > 0) {
      console.log('🔍 Available formats:', rapidData.videos.map(v => `${v.quality} (hasAudio: ${v.hasAudio})`).join(', '));

      // Priority 1: Find video with audio (360p, 480p, 720p)
      for (const video of rapidData.videos) {
        if (video.hasAudio && (video.quality === '360p' || video.quality === '480p' || video.quality === '720p')) {
          downloadUrl = video.url;
          quality = video.quality;
          console.log(`✅ Found video with audio: ${quality}`);
          break;
        }
      }

      // Priority 2: Any video with audio
      if (!downloadUrl) {
        const videoWithAudio = rapidData.videos.find(v => v.hasAudio && v.url);
        if (videoWithAudio) {
          downloadUrl = videoWithAudio.url;
          quality = videoWithAudio.quality || 'unknown';
          console.log(`✅ Found any video with audio: ${quality}`);
        }
      }

      // Priority 3: Video without audio (better than nothing for testing)
      if (!downloadUrl) {
        // Try to get 360p or 480p first
        for (const video of rapidData.videos) {
          if (video.url && (video.quality === '360p' || video.quality === '480p')) {
            downloadUrl = video.url;
            quality = video.quality + ' (no audio)';
            console.log(`⚠️ Using video without audio: ${quality}`);
            break;
          }
        }

        // Take any video
        if (!downloadUrl) {
          const anyVideo = rapidData.videos.find(v => v.url);
          if (anyVideo) {
            downloadUrl = anyVideo.url;
            quality = (anyVideo.quality || 'unknown') + ' (no audio)';
            console.log(`⚠️ Using any video: ${quality}`);
          }
        }
      }
    }

    if (!downloadUrl) {
      console.log('❌ No suitable video format found');
      console.log('📋 Full response:', JSON.stringify(rapidData, null, 2).substring(0, 500));

      return res.status(200).json({
        success: false,
        videoUrl: youtubeUrl,
        youtubeUrl: youtubeUrl,
        videoId: videoId,
        title: title,
        author: author,
        source: 'youtube-direct',
        error: 'No downloadable format found'
      });
    }

    console.log(`📥 Downloading video (${quality})...`);

    // Download the video
    const videoResponse = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.status}`);
    }

    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    console.log(`📁 Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Upload to Vercel Blob
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
    const fileName = `${Date.now()}_${safeTitle}.mp4`;

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
      title: title,
      author: author,
      duration: duration,
      quality: quality,
      source: 'rapidapi'
    });

  } catch (error) {
    console.error('❌ Error:', error);

    // Fallback: return YouTube URL
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : 'unknown';
    const youtubeUrl = videoId !== 'unknown' ? `https://www.youtube.com/watch?v=${videoId}` : url;

    return res.status(200).json({
      success: false,
      videoUrl: youtubeUrl,
      youtubeUrl: youtubeUrl,
      videoId: videoId,
      source: 'youtube-direct',
      error: error.message
    });
  }
}
