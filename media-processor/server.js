import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const app = express();
const port = Number(process.env.PORT || 8080);
const processorKey = process.env.JOINT_MEDIA_PROCESSOR_KEY || '';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, service: 'joint-media-processor' }));
function secureKey(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function requireKey(req, res, next) {
  if (!secureKey(String(req.get('X-Joint-Processor-Key') || ''), processorKey)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function escapeXml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function watermarkSvg(width, height, creator) {
  // A single compact, semi-transparent signature: JOINT + myjointapp.com.
  // Keep it in the lower-right corner and scale it with the actual image dimensions.
  const scale = Math.max(0.62, Math.min(width / 900, height / 1200, 1.25));
  const pad = Math.max(12, Math.round(18 * scale));
  const badgeH = Math.max(42, Math.round(64 * scale));
  const badgeW = Math.min(Math.round(width * 0.72), Math.round(410 * scale));
  const icon = Math.round(badgeH * 0.76);
  const iconX = width - pad - badgeW + Math.round(7 * scale);
  const iconY = height - pad - badgeH + Math.round((badgeH - icon) / 2);
  const textX = iconX + icon + Math.round(10 * scale);
  const titleSize = Math.max(16, Math.round(22 * scale));
  const siteSize = Math.max(11, Math.round(13 * scale));
  const y = height - pad - badgeH;
  const x = width - pad - badgeW;
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <g>
        <rect x="${x}" y="${y}" width="${badgeW}" height="${badgeH}" rx="${Math.round(13 * scale)}" fill="#171022" fill-opacity=".64" stroke="#ffffff" stroke-opacity=".25" stroke-width="${Math.max(1, scale)}"/>
        <rect x="${iconX}" y="${iconY}" width="${icon}" height="${icon}" rx="${Math.round(10 * scale)}" fill="#6938d1" fill-opacity=".98"/>
        <text x="${iconX + icon / 2}" y="${iconY + icon * .72}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${Math.round(icon * .62)}" font-weight="900" fill="#ffffff">J</text>
        <text x="${textX}" y="${y + badgeH * .43}" font-family="Arial,sans-serif" font-size="${titleSize}" font-weight="900" letter-spacing=".4" fill="#ffffff">JOINT</text>
        <text x="${textX}" y="${y + badgeH * .75}" font-family="Arial,sans-serif" font-size="${siteSize}" font-weight="800" fill="#f0eaff">myjointapp.com</text>
      </g>
    </svg>`
  );
}
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-1200)}`)));
  });
}
app.post('/process', requireKey, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Media file required' });
  const type = String(req.body.media_type || '').toLowerCase();
  const creator = String(req.body.creator || 'JOINT Creator').replace(/[\r\n\0]/g, ' ').slice(0, 80);
  if (!['image', 'video'].includes(type)) return res.status(400).json({ error: 'Invalid media type' });
  const dir = await mkdtemp(path.join(tmpdir(), 'joint-media-'));
  try {
    if (type === 'image') {
      if (!req.file.mimetype.startsWith('image/')) return res.status(415).json({ error: 'Expected an image' });
      const meta = await sharp(req.file.buffer, { limitInputPixels: 80_000_000 }).metadata();
      if (!meta.width || !meta.height) return res.status(422).json({ error: 'Unreadable image' });
      const overlay = watermarkSvg(meta.width, meta.height, creator);
      const output = await sharp(req.file.buffer, { limitInputPixels: 80_000_000 })
        .composite([{ input: overlay, left: 0, top: 0 }])
        .png()
        .toBuffer();
      res.set('Content-Type', 'image/png').set('Content-Disposition', 'attachment; filename="JOINT-branded.png"').set('Cache-Control', 'no-store').send(output);
      return;
    }
    if (!req.file.mimetype.startsWith('video/') && req.file.mimetype !== 'application/octet-stream') return res.status(415).json({ error: 'Expected a video file' });
    const input = path.join(dir, `source-${randomUUID()}`);
    const overlayPath = path.join(dir, 'watermark.png');
    const outputPath = path.join(dir, 'joint-branded.mp4');
    await writeFile(input, req.file.buffer);
    // Use the same compact signature as images. Scale it relative to the video width
    // and anchor it bottom-right so it doesn't dominate portrait or landscape footage.
    const overlaySvg = Buffer.from(`<svg width="460" height="72" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="458" height="70" rx="13" fill="#171022" fill-opacity=".64" stroke="#ffffff" stroke-opacity=".25" stroke-width="2"/><rect x="8" y="8" width="56" height="56" rx="10" fill="#6938d1"/><text x="36" y="48" text-anchor="middle" font-family="Arial,sans-serif" font-size="43" font-weight="900" fill="#fff">J</text><text x="78" y="31" font-family="Arial,sans-serif" font-size="24" font-weight="900" letter-spacing=".4" fill="#fff">JOINT</text><text x="78" y="53" font-family="Arial,sans-serif" font-size="15" font-weight="800" fill="#f0eaff">myjointapp.com</text></svg>`);
    await sharp(overlaySvg).png().toFile(overlayPath);
    await runFfmpeg([
      '-hide_banner','-loglevel','error','-y','-i',input,'-i',overlayPath,
      // Keep the original video stream as the first overlay input. Avoid scale2ref here:
      // it can produce inconsistent stream negotiation on some FFmpeg builds and was
      // associated with audio-only MP4 downloads. A fixed transparent PNG overlay is
      // deliberately used for reliable video output across portrait and landscape clips.
      '-filter_complex',
      '[0:v:0][1:v:0]overlay=x=W-w-18:y=H-h-18:format=auto,format=yuv420p[v]',
      '-map','[v]','-map','0:a?','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',outputPath
    ]);
    const output = await readFile(outputPath);
    res.set('Content-Type','video/mp4').set('Content-Disposition','attachment; filename="JOINT-branded.mp4"').set('Cache-Control','no-store').send(output);
  } catch (err) {
    console.error('processing failed', err);
    if (!res.headersSent) res.status(422).json({ error: 'Media could not be processed. Check that the source is a valid image or video.' });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Media must be 50 MB or smaller.' });
  console.error(err);
  res.status(500).json({ error: 'Media processing service error.' });
});
app.listen(port, '0.0.0.0', () => console.log(`JOINT media processor listening on ${port}`));
