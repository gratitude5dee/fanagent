export const renderedVideoSignedUrlSeconds = 60 * 60 * 24 * 7;

export function renderedVideoStoragePath(accountId: string, libraryItemId: string): string {
  return `renders/${accountId}/${libraryItemId}.mp4`;
}
