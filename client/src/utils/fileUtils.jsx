
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File reading failed'));
    reader.onload = () => resolve(reader.result); // base64 DataURL
    reader.readAsDataURL(file);
  });
}
