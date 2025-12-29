import { put } from '@vercel/blob';
import { execSync, spawn } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

  const tempFiles = [];

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
      throw new Error(`RapidAPI returned ${rapidResponse.status}`);
    }

    const rapidData = await rapidResponse.json();
    console.log('✅ RapidAPI response received');
    console.log('📊 Videos:', rapidData.videos?.length || 0, '| Audios:', rapidData.audios?.length || 0);

    let title = rapidData.title || 'Unknown';
    let author = rapidData.channel?.name || 'Unknown';
    let duration = rapidData.lengthSeconds || 0;

    // First, try to find a video WITH audio (progressive stream)
    let videoWithAudio = null;
    if (rapidData.videos) {
      videoWithAudio = rapidData.videos.find(v => v.hasAudio && v.url &&
        (v.quality === '360p' || v.quality === '480p' || v.quality === '720p'));

      if (!videoWithAudio) {
        videoWithAudio = rapidData.videos.find(v => v.hasAudio && v.url);
      }
    }

    if (videoWithAudio) {
      // Found progressive stream with audio - use it directly
      console.log(`✅ Found progressive stream: ${videoWithAudio.quality}`);

      const videoResponse = await fetch(videoWithAudio.url);
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      console.log(`📁 Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

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
        quality: videoWithAudio.quality,
        source: 'rapidapi'
      });
    }

    // No progressive stream - need to merge video + audio
    console.log('⚠️ No progressive stream, merging video + audio...');

    // Find best video stream (no audio)
    let videoStream = null;
    if (rapidData.videos) {
      videoStream = rapidData.videos.find(v => !v.hasAudio && v.url &&
        (v.quality === '360p' || v.quality === '480p'));
      if (!videoStream) {
        videoStream = rapidData.videos.find(v => v.url);
      }
    }

    // Find best audio stream
    let audioStream = null;
    if (rapidData.audios) {
      audioStream = rapidData.audios.find(a => a.url);
    }

    if (!videoStream || !audioStream) {
      console.log('❌ Could not find video or audio stream');
      return res.status(200).json({
        success: false,
        videoUrl: youtubeUrl,
        youtubeUrl: youtubeUrl,
        videoId: videoId,
        title: title,
        source: 'youtube-direct',
        error: 'No suitable streams found'
      });
    }

    console.log(`📥 Downloading video (${videoStream.quality || 'unknown'})...`);
    const videoResponse = await fetch(videoStream.url);
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    console.log(`📁 Video: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    console.log('📥 Downloading audio...');
    const audioResponse = await fetch(audioStream.url);
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    console.log(`📁 Audio: ${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Save to temp files
    const videoPath = join(tmpdir(), `video_${Date.now()}.mp4`);
    const audioPath = join(tmpdir(), `audio_${Date.now()}.m4a`);
    const outputPath = join(tmpdir(), `merged_${Date.now()}.mp4`);

    tempFiles.push(videoPath, audioPath, outputPath);

    writeFileSync(videoPath, videoBuffer);
    writeFileSync(audioPath, audioBuffer);

    console.log('🔧 Merging video + audio with FFmpeg...');

    // Merge with FFmpeg - use -shortest to match lengths
    try {
      execSync(`ffmpeg -i ${videoPath} -i ${audioPath} -c:v copy -c:a aac -shortest ${outputPath}`, {
        timeout: 50000  // 50 second timeout
      });
    } catch (ffmpegError) {
      console.log('⚠️ FFmpeg merge failed:', ffmpegError.message);
      // Fallback: just use video without audio
      writeFileSync(outputPath, videoBuffer);
    }

    const mergedBuffer = readFileSync(outputPath);
    console.log(`📁 Merged: ${(mergedBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Upload to Vercel Blob
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
    const fileName = `${Date.now()}_${safeTitle}.mp4`;

    const blob = await put(fileName, mergedBuffer, {
      access: 'public',
      addRandomSuffix: true,
    });

    console.log('☁️ Uploaded to:', blob.url);

    // Cleanup temp files
    for (const file of tempFiles) {
      try { unlinkSync(file); } catch (e) { }
    }

    return res.status(200).json({
      success: true,
      videoUrl: blob.url,
      youtubeUrl: youtubeUrl,
      videoId: videoId,
      title: title,
      author: author,
      duration: duration,
      quality: (videoStream.quality || 'unknown') + ' (merged)',
      source: 'rapidapi'
    });

  } catch (error) {
    console.error('❌ Error:', error);

    // Cleanup temp files
    for (const file of tempFiles) {
      try { unlinkSync(file); } catch (e) { }
    }

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
