//// imgbb API image upload helper for React
// PUBLIC_INTERFACE
/**
 * Uploads an image (as a base64 string) to imgbb.
 * @param {string|Blob} image - base64 encoded image data or Blob.
 * @returns {Promise<string>} URL of hosted image.
 *
 * Uses the imgbb API key from environment (REACT_APP_IMGBB_KEY).
 * 
 * Example usage:
 *   const url = await uploadToImgbb(imageBase64);
 */
export async function uploadToImgbb(image) {
  const apiKey = process.env.REACT_APP_IMGBB_KEY;
  if (!apiKey) throw new Error("IMGBB API key is missing");

  let base64Image;
  if (typeof image === 'string' && image.startsWith('data:')) {
    // Data URL: "data:image/png;base64,..."
    base64Image = image.split(',')[1]; // Get only base64 part
  } else if (typeof image === 'string') {
    base64Image = image;
  } else if (image instanceof Blob) {
    base64Image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(image);
    });
  } else {
    throw new Error("Image must be a base64 string or Blob");
  }

  const form = new FormData();
  form.append('image', base64Image);

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) throw new Error("Failed to upload image to imgbb");

  const result = await response.json();
  return result.data && result.data.url ? result.data.url : null;
}
