/**
 * Téléchargement d'un fichier produit localement (lien `download` sur une URL
 * blob:) : ne nécessite pas la permission `downloads`.
 */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
