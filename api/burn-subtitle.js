import { put } from '@vercel/blob';
import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

    const { videoUrl, srtContent, outputFileName } = req.body;

    if (!videoUrl || !srtContent) {
        return res.status(400).json({
            error: 'Missing required fields: videoUrl, srtContent'
        });
    }

    const tempDir = join(tmpdir(), 'video-clipper');
    const inputPath = join(tempDir, `input_${Date.now()}.mp4`);
    const srtPath = join(tempDir, `subtitle_${Date.now()}.srt`);
    const outputPath = join(tempDir, `output_${Date.now()}.mp4`);

    try {
        console.log('🔤 Burning subtitles to video...');

        // Ensure temp directory exists
        if (!existsSync(tempDir)) {
            mkdirSync(tempDir, { recursive: true });
        }

        // Download video
        console.log('📥 Downloading source video...');
        const videoResponse = await fetch(videoUrl);
        if (!videoResponse.ok) {
            throw new Error(`Failed to fetch video: ${videoResponse.status}`);
        }
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        writeFileSync(inputPath, videoBuffer);
        console.log(`✅ Source downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        // Save SRT file
        writeFileSync(srtPath, srtContent, 'utf-8');
        console.log('📝 SRT file saved');

        // Run FFmpeg to burn subtitles
        // Using drawtext filter for compatibility (subtitles filter may not work in all environments)
        console.log('🎬 Running FFmpeg with subtitle filter...');
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-y',
                '-i', inputPath,
                '-vf', `subtitles=${srtPath}:force_style='FontName=Arial,FontSize=24,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2,Shadow=1,MarginV=30'`,
                '-c:v', 'libx264',
                '-c:a', 'copy',
                '-preset', 'fast',
                '-crf', '23',
                outputPath
            ]);

            let stderr = '';
            ffmpeg.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
                }
            });

            ffmpeg.on('error', reject);
        });

        // Read output video
        const subtitledBuffer = readFileSync(outputPath);
        console.log(`✅ Subtitled: ${(subtitledBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        // Upload to Vercel Blob
        const fileName = outputFileName || `subtitled_${Date.now()}.mp4`;
        const blob = await put(fileName, subtitledBuffer, {
            access: 'public',
            addRandomSuffix: true,
        });

        console.log('☁️ Uploaded to:', blob.url);

        // Cleanup temp files
        if (existsSync(inputPath)) unlinkSync(inputPath);
        if (existsSync(srtPath)) unlinkSync(srtPath);
        if (existsSync(outputPath)) unlinkSync(outputPath);

        return res.status(200).json({
            success: true,
            finalVideoUrl: blob.url
        });

    } catch (error) {
        console.error('❌ Burn subtitle error:', error);

        // Cleanup on error
        if (existsSync(inputPath)) unlinkSync(inputPath);
        if (existsSync(srtPath)) unlinkSync(srtPath);
        if (existsSync(outputPath)) unlinkSync(outputPath);

        return res.status(500).json({
            error: error.message,
            details: 'Failed to burn subtitle to video'
        });
    }
}
