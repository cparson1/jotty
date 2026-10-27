const MAX_COVER_IMAGE_URL_LENGTH = 2048;

export const normalizeCoverImageUrl = (
  value: string | null | undefined,
): string | undefined => {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed.length > MAX_COVER_IMAGE_URL_LENGTH) return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
};
