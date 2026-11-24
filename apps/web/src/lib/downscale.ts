export const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const DOWNSCALE_THRESHOLD_BYTES = 2 * 1024 * 1024;

/**
 * Files <= 2 MB are sent untouched (preserving exact SHA-256 cache hits).
 * Larger files are redrawn to an HTMLCanvasElement and exported as baseline JPEG
 * (quality 0.85, max edge 1600px) — never WebP — so the backend's baseline-JPEG
 * DC-luminance dHash keeps hitting the perceptual cache.
 */
export async function downscaleIfLarge(
  file: File,
  maxBytes = DOWNSCALE_THRESHOLD_BYTES,
  maxEdge = 1600
): Promise<File> {
  if (file.size <= maxBytes) return file;
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // Flatten PNG/WebP transparency onto crisp white paper before JPEG encoding
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Baseline JPEG encode failed'))),
      'image/jpeg',
      0.85
    )
  );
  const baseName = file.name ? file.name.replace(/\.[^.]+$/, '') : 'card';
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
}
