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
  const scale = Math.max(1, Math.min(width, height) / 600);
  const pad = Math.round(18 * scale), boxH = Math.round(58 * scale), font = Math.round(22 * scale), sub = Math.round(14 * scale);
  const name = escapeXml(creator.slice(0, 80));
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="${pad}" y="${pad}" width="${Math.min(width-pad*2, 420*scale)}" height="${boxH}" rx="${Math.round(10*scale)}" fill="#20113f" fill-opacity=".82"/><rect x="${pad}" y="${pad}" width="${boxH}" height="${boxH}" rx="${Math.round(10*scale)}" fill="#6938d1"/><text x="${pad+boxH/2}" y="${pad+boxH*.69}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${Math.round(boxH*.58)}" font-weight="900" fill="#fff">J</text><text x="${pad+boxH+12*scale}" y="${pad+font+2*scale}" font-family="Arial,sans-serif" font-size="${font}" font-weight="800" fill="#fff">JOINT</text><text x="${pad+boxH+12*scale}" y="${pad+boxH-sub*.4}" font-family="Arial,sans-serif" font-size="${sub}" fill="#f0eaff">myjointapp.com · ${name}</text></svg>`);
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
      const footerH = Math.max(48, Math.round(meta.height * 0.085));
      const footer = Buffer.from(`<svg width="${meta.width}" height="${footerH}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#20113f"/><text x="50%" y="42%" text-anchor="middle" font-family="Arial,sans-serif" font-size="${Math.max(14, Math.round(footerH*.25))}" font-weight="800" fill="#fff">JOINT · Learn, connect, and grow together</text><text x="50%" y="78%" text-anchor="middle" font-family="Arial,sans-serif" font-size="${Math.max(12, Math.round(footerH*.21))}" font-weight="700" fill="#d8c6ff">myjointapp.com</text></svg>`);
      const output = await sharp(req.file.buffer, { limitInputPixels: 80_000_000 }).composite([{ input: overlay, left: 0, top: 0 }, { input: footer, left: 0, top: meta.height - footerH }]).png().toBuffer();
      res.set('Content-Type', 'image/png').set('Content-Disposition', 'attachment; filename="JOINT-branded.png"').set('Cache-Control', 'no-store').send(output);
      return;
    }
    if (!req.file.mimetype.startsWith('video/')) return res.status(415).json({ error: 'Expected a video' });
    const input = path.join(dir, `source-${randomUUID()}`);
    const overlayPath = path.join(dir, 'watermark.png');
    const outputPath = path.join(dir, 'joint-branded.mp4');
    await writeFile(input, req.file.buffer);
    // Create a transparent watermark canvas and overlay it at the top-left throughout the video.
    const overlaySvg = Buffer.from(`<svg width="460" height="72" xmlns="http://www.w3.org/2000/svg"><rect width="460" height="72" rx="12" fill="#20113f" fill-opacity=".82"/><rect width="72" height="72" rx="12" fill="#6938d1"/><text x="36" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" font-weight="900" fill="#fff">J</text><text x="90" y="31" font-family="Arial,sans-serif" font-size="25" font-weight="800" fill="#fff">JOINT</text><text x="90" y="54" font-family="Arial,sans-serif" font-size="15" fill="#f0eaff">myjointapp.com · ${escapeXml(creator)}</text></svg>`);
    await sharp(overlaySvg).png().toFile(overlayPath);
    await runFfmpeg(['-hide_banner','-loglevel','error','-y','-i',input,'-i',overlayPath,'-filter_complex','[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[base];[base][1:v]overlay=16:16:format=auto[v]','-map','[v]','-map','0:a?','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart','-shortest',outputPath]);
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
