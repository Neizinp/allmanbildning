// GitHub Pages cachar filer i tio minuter; byggnumret gör att nya data syns direkt efter en publicering.
export const versioned = (url: string) => `${url}?v=${__BUILD_ID__}`;
