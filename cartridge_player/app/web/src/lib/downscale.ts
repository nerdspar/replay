/**
 * Downscale in the browser before uploading.
 *
 * This is the mechanism that keeps custom artwork from becoming the "hundreds of
 * megabytes on a disk with other demands" the spec warns about: a phone photo or
 * a 4K poster lands as ~150 kB instead of 5 MB. The server's size cap is only a
 * backstop.
 */
/*
 * Sized for paper, not for the screen. The tallest sticker is 90 mm, which at
 * 300 DPI wants 1063 px — so 1000 would have been fractionally short. 1400 puts
 * a 60 x 90 mm label at about 395 DPI, past what any home printer resolves,
 * while still landing around 300-450 kB per image rather than the 2-3 MB a
 * print-grade poster arrives as.
 */
const MAX_EDGE = 1400
const JPEG_QUALITY = 0.85

export interface DownscaledImage {
  blob: Blob
  width: number
  height: number
}

export async function downscaleImage(file: File): Promise<DownscaledImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.')
  }

  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser could not process that image.')

  // Flatten onto white: a transparent PNG would otherwise go black as JPEG.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  if ('close' in bitmap) bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  )
  if (!blob) throw new Error('Your browser could not process that image.')

  return { blob, width, height }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // Fall through — some browsers refuse certain sources here.
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    // Revoking after decode is safe; the bitmap is already in memory.
    URL.revokeObjectURL(url)
  }
}
