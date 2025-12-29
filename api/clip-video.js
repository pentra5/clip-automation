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

    const { videoUrl, startTime, duration, outputFileName } = req.body;

    if (!videoUrl || startTime === undefined || !duration) {
        return res.status(400).json({
            error: 'Missing required fields: videoUrl, startTime, duration'
        });
    }

    const tempDir = join(tmpdir(), 'video-clipper');
    const inputPath = join(tempDir, `input_${Date.now()}.mp4`);
    const outputPath = join(tempDir, `output_${Date.now()}.mp4`);

    try {
        console.log(`✂️ Clipping video from ${startTime}s for ${duration}s`);

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

        // Run FFmpeg to clip video
        console.log('🎬 Running FFmpeg...');
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-y',
                '-ss', String(startTime),
                '-i', inputPath,
                '-t', String(duration),
                '-c:v', 'libx264',
                '-c:a', 'aac',
                '-movflags', '+faststart',
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

        // Read clipped video
        const clippedBuffer = readFileSync(outputPath);
        console.log(`✅ Clipped: ${(clippedBuffer.length / 1024 / 1024).toFixed(2)} MB`);

        // Upload to Vercel Blob
        const fileName = outputFileName || `clip_${Date.now()}.mp4`;
        const blob = await put(fileName, clippedBuffer, {
            access: 'public',
            addRandomSuffix: true,
        });

        console.log('☁️ Uploaded to:', blob.url);

        // Cleanup temp files
        if (existsSync(inputPath)) unlinkSync(inputPath);
        if (existsSync(outputPath)) unlinkSync(outputPath);

        return res.status(200).json({
            success: true,
            clippedVideoUrl: blob.url,
            clippedVideoPath: fileName,
            startTime,
            duration
        });

    } catch (error) {
        console.error('❌ Clip error:', error);

        // Cleanup on error
        if (existsSync(inputPath)) unlinkSync(inputPath);
        if (existsSync(outputPath)) unlinkSync(outputPath);

        return res.status(500).json({
            error: error.message,
            details: 'Failed to clip video'
        });
    }
}
