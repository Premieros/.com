/** Resize large still photos before an upload. Keep the original if encoding fails or grows it. */
export async function optimizePhoto(file: File, maxEdge: number): Promise<File> {
  if (file.size < 160_000 || !['image/jpeg', 'image/png'].includes(file.type)
    || typeof createImageBitmap !== 'function') return file;

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const photo = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.84));
    return photo?.type === 'image/webp' && photo.size < file.size
      ? new File([photo], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: photo.type })
      : file;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
