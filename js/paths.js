export const siteURL = (path) => new URL(path, new URL("../", import.meta.url)).href;
